from __future__ import annotations

import unittest
import warnings
from pathlib import Path
from types import SimpleNamespace

from starlette.exceptions import StarletteDeprecationWarning

warnings.filterwarnings(
    "ignore",
    message=r"Using `httpx` with `starlette\.testclient` is deprecated.*",
    category=StarletteDeprecationWarning,
)

from fastapi.testclient import TestClient

import app as service


class FakeWhisperModel:
    source_language: str | None | object = object()

    def transcribe(
        self,
        path: str,
        *,
        language: str | None,
        beam_size: int,
        vad_filter: bool,
        word_timestamps: bool,
    ):
        assert Path(path).is_file()
        assert beam_size == service.settings.beam_size
        assert vad_filter is service.settings.vad_filter
        assert word_timestamps is True
        self.source_language = language
        word = SimpleNamespace(word=" 你好", start=0.1, end=0.5, probability=0.99)
        segment = SimpleNamespace(
            text=" 你好 ",
            start=0.1,
            end=0.5,
            avg_logprob=-0.1,
            no_speech_prob=0.01,
            words=[word],
        )
        info = SimpleNamespace(language="zh", language_probability=0.98, duration=0.6)
        return iter([segment]), info


class LocalAsrApiTest(unittest.TestCase):
    def test_openai_compatible_endpoint_auto_detects_source_language(self) -> None:
        fake_model = FakeWhisperModel()
        original_load_model = service.load_model
        service.load_model = lambda: fake_model
        try:
            headers = (
                {"authorization": f"Bearer {service.settings.api_key}"}
                if service.settings.api_key
                else {}
            )
            with TestClient(service.app) as client:
                response = client.post(
                    "/v1/audio/transcriptions",
                    headers=headers,
                    data={"model": service.settings.model, "response_format": "verbose_json"},
                    files={"file": ("audio.wav", b"RIFF-test-audio", "audio/wav")},
                )
                mismatch = client.post(
                    "/v1/audio/transcriptions",
                    headers=headers,
                    data={"model": "different-model"},
                    files={"file": ("audio.wav", b"RIFF-test-audio", "audio/wav")},
                )
        finally:
            service.load_model = original_load_model

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["x-request-id"].startswith("asr_"))
        self.assertEqual(response.json()["text"], "你好")
        self.assertEqual(response.json()["language"], "zh")
        self.assertEqual(len(response.json()["segments"]), 1)
        self.assertIsNone(fake_model.source_language)
        self.assertEqual(mismatch.status_code, 400)


if __name__ == "__main__":
    unittest.main()
