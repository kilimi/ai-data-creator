# Multi-stage build: slim CPU runtime for the backend API.
# Model weights are NOT baked in — they live on a host volume (see docker-compose.yml).
# To pre-download models after `make up`, run: `make download-models`.
# GPU training/eval uses Dockerfile.celery (lai-celery), not this image.
#
# MMYOLO stack is COPIED from lai-mmyolo (Dockerfile.mmyolo.runtime).
#
# Build order:
#   docker compose --profile build build ultralytics_runtime mmyolo_runtime
#   docker compose build celery_worker
#   docker compose build backend

# Must be before the first FROM — required for `FROM ${MMYOLO_IMAGE}` in stage 2.
ARG MMYOLO_IMAGE=lai-mmyolo:local

# ---------- Stage 1: app deps builder ----------
FROM python:3.10-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ cmake git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY requirements-backend.txt .

# CPU PyTorch first so transitive deps (fiftyone, etc.) do not pull CUDA wheels.
RUN pip install --upgrade pip \
 && pip install --default-timeout=1000 --retries 5 \
        --prefix=/install \
        'numpy>=1.23.0,<2' \
        torch torchvision \
        --index-url https://download.pytorch.org/whl/cpu \
 && pip install --default-timeout=1000 --retries 5 \
        --prefix=/install -r requirements-backend.txt \
 && pip install --default-timeout=1000 --retries 5 \
        --prefix=/install \
        'ultralytics>=8.2.0,<8.4.11' \
        'matplotlib>=3.3.0' 'pyyaml>=5.3.1' 'requests>=2.23.0' \
        'scipy>=1.4.1' 'psutil' 'polars' 'ultralytics-thop>=2.0.0'

# Safety net: never ship NVIDIA CUDA libs into the API image.
RUN rm -rf \
        /install/lib/python3.10/site-packages/nvidia \
        /install/lib/python3.10/site-packages/nvidia_* \
        /install/lib/python3.10/site-packages/*nvidia*.dist-info \
        /install/lib/python3.10/site-packages/triton \
        /install/lib/python3.10/site-packages/triton-* \
        /install/lib/python3.10/site-packages/*triton*.dist-info


# ---------- Stage 2: MMYOLO stack from lai-mmyolo (no reinstall) ----------
# Image tag must exist locally. Override via build-arg MMYOLO_IMAGE.
FROM ${MMYOLO_IMAGE} AS mmyolo-stack


# ---------- Stage 3: runtime ----------
FROM python:3.10-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/app \
    PYTHONPATH=/opt/lai/lib/python3.10/site-packages \
    PATH=/opt/lai/bin:$PATH \
    MMYOLO_PYTHON=/opt/conda/envs/mmyolo/bin/python

# OpenCV / PyTorch (conda) runtime libs on slim base
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 libgomp1 libgcc-s1 \
        curl postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /install /opt/lai
COPY --from=mmyolo-stack /opt/conda /opt/conda
COPY --from=mmyolo-stack /opt/mmyolo /opt/mmyolo

# Application code (model weights excluded via .dockerignore)
COPY . .

ENV PYTHONNOUSERSITE=1

RUN mkdir -p /app/models /app/ai_models/depth_estimation /app/projects /app/data /app/runs

EXPOSE 8000 5151

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "debug", "--reload"]
