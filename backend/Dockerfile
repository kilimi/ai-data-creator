# Multi-stage build: slim CPU runtime for the backend API.
# Model weights are NOT baked in — they live on a host volume (see docker-compose.yml).
# To pre-download models after `make up`, run: `make download-models`.
# GPU training/eval uses Dockerfile.training (lai-celery), not this image.
#
# Stages:
#   builder      – installs Python deps for the FastAPI app
#   mmyolo-venv  – builds a self-contained venv with OpenMMLab + MMYOLO for CPU inference
#   runtime      – slim final image

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
        torch torchvision \
        --index-url https://download.pytorch.org/whl/cpu \
 && pip install --default-timeout=1000 --retries 5 \
        --prefix=/install -r requirements-backend.txt \
 && pip install --default-timeout=1000 --retries 5 \
        --prefix=/install \
        'ultralytics>=8.0.0' \
        'matplotlib>=3.3.0' 'pyyaml>=5.3.1' 'requests>=2.23.0' \
        'scipy>=1.4.1' 'psutil' 'polars' 'ultralytics-thop>=2.0.0'

# Safety net: never ship NVIDIA CUDA libs into the API image.
RUN rm -rf \
        /install/lib/python3.10/site-packages/nvidia \
        /install/lib/python3.10/site-packages/triton \
        /install/lib/python3.10/site-packages/triton-* \
        /install/lib/python3.10/site-packages/*triton*.dist-info


# ---------- Stage 2: MMYOLO venv builder ----------
# Builds /opt/mmyolo-venv with CPU PyTorch + OpenMMLab stack for single-image
# inference in the API container (no GPU required).
FROM python:3.10-slim AS mmyolo-venv

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ cmake git \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/mmyolo-venv

# CPU PyTorch into the venv (required by mmcv / mmdet / mmyolo)
RUN /opt/mmyolo-venv/bin/pip install --upgrade pip \
 && /opt/mmyolo-venv/bin/pip install --default-timeout=1000 --retries 5 \
        torch torchvision \
        --index-url https://download.pytorch.org/whl/cpu

# OpenMMLab stack via openmim (resolves correct wheel for the installed torch)
RUN /opt/mmyolo-venv/bin/pip install --default-timeout=1000 --retries 5 openmim \
 && /opt/mmyolo-venv/bin/python -m mim install --default-timeout=1000 "mmengine>=0.6.0" \
 && /opt/mmyolo-venv/bin/python -m mim install --default-timeout=1000 "mmcv>=2.0.0rc4,<2.1.0" \
 && /opt/mmyolo-venv/bin/python -m mim install --default-timeout=1000 "mmdet>=3.0.0,<4.0.0"

# MMYOLO itself
RUN git clone --depth 1 https://github.com/open-mmlab/mmyolo.git /opt/mmyolo \
 && /opt/mmyolo-venv/bin/pip install --default-timeout=1000 --retries 5 \
        -r /opt/mmyolo/requirements/albu.txt \
 && /opt/mmyolo-venv/bin/python -m mim install --default-timeout=1000 -v -e /opt/mmyolo

# Strip CUDA packages from the venv (CPU-only image)
RUN rm -rf \
        /opt/mmyolo-venv/lib/python3.10/site-packages/nvidia \
        /opt/mmyolo-venv/lib/python3.10/site-packages/triton \
        /opt/mmyolo-venv/lib/python3.10/site-packages/triton-* \
        /opt/mmyolo-venv/lib/python3.10/site-packages/*triton*.dist-info


# ---------- Stage 3: runtime ----------
FROM python:3.10-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/app \
    PYTHONPATH=/opt/lai/lib/python3.10/site-packages \
    PATH=/opt/lai/bin:$PATH \
    # Default MMYOLO Python — matches the venv we built above.
    MMYOLO_PYTHON=/opt/mmyolo-venv/bin/python

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 libgomp1 \
        curl postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /install /opt/lai
COPY --from=mmyolo-venv /opt/mmyolo-venv /opt/mmyolo-venv
COPY --from=mmyolo-venv /opt/mmyolo /opt/mmyolo

# Application code (model weights excluded via .dockerignore)
COPY . .

ENV PYTHONNOUSERSITE=1

# Ensure mount points exist even before volumes are bound
RUN mkdir -p /app/models /app/ai_models/depth_estimation /app/projects /app/data /app/runs

EXPOSE 8000 5151

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "debug", "--reload"]
