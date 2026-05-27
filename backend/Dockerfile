# Multi-stage build: slim CPU runtime for the backend API.
# Model weights are NOT baked in — they live on a host volume (see docker-compose.yml).
# To pre-download models after `make up`, run: `make download-models`.
# GPU training/eval uses Dockerfile.training (lai-celery), not this image.
#
# Stages:
#   builder        – installs Python deps for the FastAPI app
#   mmyolo-builder – same conda + OpenMMLab stack as Dockerfile.training (celery_worker)
#   runtime        – slim final image

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


# ---------- Stage 2: MMYOLO (same install as Dockerfile.training / celery_worker) ----------
FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime AS mmyolo-builder

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade \
    pip==23.3.1 \
    setuptools==68.2.2 \
    wheel==0.41.2

# Identical to lai-celery: conda env + mim + mmyolo (pre-built mmcv wheels, no source build).
RUN conda create -n mmyolo python=3.8 pytorch==1.10.1 torchvision==0.11.2 cudatoolkit=11.3 -c pytorch -y \
 && PYTHONPATH= conda run -n mmyolo pip install openmim \
 && PYTHONPATH= conda run -n mmyolo python -m mim install "mmengine>=0.6.0" \
 && PYTHONPATH= conda run -n mmyolo python -m mim install "mmcv>=2.0.0rc4,<2.1.0" \
 && PYTHONPATH= conda run -n mmyolo python -m mim install "mmdet>=3.0.0,<4.0.0" \
 && git clone --depth 1 https://github.com/open-mmlab/mmyolo.git /opt/mmyolo \
 && PYTHONPATH= conda run -n mmyolo pip install -r /opt/mmyolo/requirements/albu.txt \
 && PYTHONPATH= conda run -n mmyolo python -m mim install -v -e /opt/mmyolo


# ---------- Stage 3: runtime ----------
FROM python:3.10-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/app \
    PYTHONPATH=/opt/lai/lib/python3.10/site-packages \
    PATH=/opt/lai/bin:$PATH \
    # Same path as celery_worker (Dockerfile.training).
    MMYOLO_PYTHON=/opt/conda/envs/mmyolo/bin/python

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 libgomp1 \
        curl postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /install /opt/lai
# Conda prefix + mmyolo repo (required for editable install / configs).
COPY --from=mmyolo-builder /opt/conda /opt/conda
COPY --from=mmyolo-builder /opt/mmyolo /opt/mmyolo

# Application code (model weights excluded via .dockerignore)
COPY . .

ENV PYTHONNOUSERSITE=1

# Ensure mount points exist even before volumes are bound
RUN mkdir -p /app/models /app/ai_models/depth_estimation /app/projects /app/data /app/runs

EXPOSE 8000 5151

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "debug", "--reload"]
