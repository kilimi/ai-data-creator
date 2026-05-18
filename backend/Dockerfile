# Multi-stage build: slim runtime on official PyTorch+CUDA base.
# Model weights are NOT baked in — they live on a host volume (see docker-compose.yml).
# To pre-download models after `make up`, run: `make download-models`.

# ---------- Stage 1: builder ----------
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ cmake git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY requirements.txt .

# Install Python deps into a portable prefix. torch/torchvision are provided by
# the runtime base image, so they are filtered out here to avoid wasted layers.
RUN pip install --upgrade pip \
 && grep -viE '^(torch|torchvision)([<>=!~ ].*)?$' requirements.txt > /tmp/req.txt \
 && pip install --default-timeout=1000 --retries 5 \
        --prefix=/install -r /tmp/req.txt \
 && pip install --default-timeout=1000 --retries 5 \
        --prefix=/install 'celery[redis]>=5.3.0' 'redis>=5.0.0' 'flower>=2.0.0' 'fiftyone>=0.23.0'

# ---------- Stage 2: runtime ----------
FROM pytorch/pytorch:2.7.1-cuda12.6-cudnn9-runtime AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/app \
    PYTHONPATH=/opt/lai/lib/python3.11/site-packages \
    PATH=/opt/lai/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 libgomp1 \
        curl postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy installed site-packages from builder
COPY --from=builder /install /opt/lai

# Application code
COPY . .

# Ensure mount points exist even before volumes are bound
RUN mkdir -p /app/models /app/ai_models/depth_estimation /app/projects /app/data /app/runs

EXPOSE 8000 5151

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "debug", "--reload"]
