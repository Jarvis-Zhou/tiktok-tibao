from __future__ import annotations

import asyncio
import hmac
import os
import tempfile
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel


def positive_int(name: str, fallback: int) -> int:
    try:
        value = int(os.getenv(name, ""))
    except ValueError:
        return fallback
    return value if value > 0 else fallback


def boolean_value(name: str, fallback: bool) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return fallback
    return value.strip().lower() not in {"0", "false", "off", "no"}


@dataclass(frozen=True)
class Settings:
    model: str = os.getenv("ASR_MODEL", "small").strip() or "small"
    device: str = os.getenv("ASR_DEVICE", "cpu").strip() or "cpu"
    compute_type: str = os.getenv("ASR_COMPUTE_TYPE", "int8").strip() or "int8"
    model_dir: str = os.getenv("ASR_MODEL_DIR", "/models").strip() or "/models"
    api_key: str = os.getenv("ASR_API_KEY", "").strip()
    cpu_threads: int = positive_int("ASR_CPU_THREADS", 4)
    max_concurrency: int = positive_int("ASR_MAX_CONCURRENCY", 1)
    max_file_bytes: int = positive_int("ASR_MAX_FILE_BYTES", 50 * 1024 * 1024)
    beam_size: int = positive_int("ASR_BEAM_SIZE", 5)
    vad_filter: bool = boolean_value("ASR_VAD_FILTER", True)
    local_files_only: bool = boolean_value("ASR_LOCAL_FILES_ONLY", False)


settings = Settings()


class RuntimeState:
    model: WhisperModel | None = None


state = RuntimeState()
semaphore = asyncio.Semaphore(settings.max_concurrency)


def load_model() -> WhisperModel:
    Path(settings.model_dir).mkdir(parents=True, exist_ok=True)
    return WhisperModel(
        settings.model,
        device=settings.device,
        compute_type=settings.compute_type,
        cpu_threads=settings.cpu_threads,
        num_workers=1,
        download_root=settings.model_dir,
        local_files_only=settings.local_files_only,
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    state.model = await asyncio.to_thread(load_model)
    try:
        yield
    finally:
        state.model = None


app = FastAPI(title="Tibao Local ASR", version="1.0.0", lifespan=lifespan)


def authorize(authorization: str | None) -> None:
    if not settings.api_key:
        return
    expected = f"Bearer {settings.api_key}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Invalid ASR bearer token")


def transcribe_file(path: str, source_language: str | None) -> dict[str, Any]:
    model = state.model
    if model is None:
        raise RuntimeError("ASR model is not ready")
    segments_iterator, info = model.transcribe(
        path,
        language=source_language or None,
        beam_size=settings.beam_size,
        vad_filter=settings.vad_filter,
        word_timestamps=True,
    )
    segments: list[dict[str, Any]] = []
    transcript_parts: list[str] = []
    for index, segment in enumerate(segments_iterator):
        text = segment.text.strip()
        if text:
            transcript_parts.append(text)
        words = [
            {
                "word": word.word,
                "start": round(float(word.start), 3),
                "end": round(float(word.end), 3),
                "probability": round(float(word.probability), 6),
            }
            for word in (segment.words or [])
        ]
        segments.append(
            {
                "id": index,
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "text": text,
                "avg_logprob": float(segment.avg_logprob),
                "no_speech_prob": float(segment.no_speech_prob),
                "words": words,
            }
        )
    return {
        "text": " ".join(transcript_parts).strip(),
        "language": str(info.language),
        "language_probability": float(info.language_probability),
        "duration": round(float(info.duration), 3),
        "segments": segments,
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": state.model is not None,
        "provider": "faster-whisper",
        "model": settings.model,
        "device": settings.device,
        "compute_type": settings.compute_type,
        "max_concurrency": settings.max_concurrency,
    }


@app.post("/v1/audio/transcriptions")
async def create_transcription(
    file: Annotated[UploadFile, File(...)],
    model: Annotated[str, Form()] = "",
    response_format: Annotated[str, Form()] = "verbose_json",
    language: Annotated[str | None, Form()] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> JSONResponse:
    authorize(authorization)
    requested_model = model.strip() or settings.model
    if requested_model != settings.model:
        raise HTTPException(
            status_code=400,
            detail=f"Requested model {requested_model!r} is not loaded",
        )
    if response_format not in {"json", "verbose_json"}:
        raise HTTPException(status_code=400, detail="response_format must be json or verbose_json")

    suffix = Path(file.filename or "audio.wav").suffix.lower()
    if suffix not in {".wav", ".mp3", ".m4a", ".mp4", ".webm", ".ogg", ".flac"}:
        suffix = ".audio"
    temporary_path = ""
    total_bytes = 0
    try:
        with tempfile.NamedTemporaryFile(prefix="tibao-asr-", suffix=suffix, delete=False) as target:
            temporary_path = target.name
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > settings.max_file_bytes:
                    raise HTTPException(status_code=413, detail="Audio file exceeds the configured limit")
                target.write(chunk)
        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="Audio file is empty")

        async with semaphore:
            result = await asyncio.to_thread(
                transcribe_file,
                temporary_path,
                language.strip() if language and language.strip() else None,
            )
        request_id = f"asr_{uuid.uuid4().hex}"
        payload = result if response_format == "verbose_json" else {"text": result["text"]}
        return JSONResponse(payload, headers={"x-request-id": request_id})
    finally:
        await file.close()
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)
