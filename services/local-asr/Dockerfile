ARG PYTHON_IMAGE=python:3.11-slim-bookworm
FROM ${PYTHON_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY services/local-asr/requirements.txt ./requirements.txt
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir --index-url "${PIP_INDEX_URL}" --requirement requirements.txt \
    && groupadd --system asr \
    && useradd --system --gid asr --home-dir /app --no-create-home asr \
    && mkdir -p /models \
    && chown -R asr:asr /app /models

ENV HF_HOME=/models/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_HUB_DISABLE_XET=1 \
    HF_HUB_DOWNLOAD_TIMEOUT=300 \
    HF_HUB_ETAG_TIMEOUT=30 \
    ASR_MODEL_DIR=/models

COPY --chown=asr:asr services/local-asr/app.py services/local-asr/test_app.py ./
RUN python -m unittest --verbose test_app.py

USER asr
VOLUME ["/models"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5m --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
