# Use PyTorch 2.5+ for SAM 2 (segment-anything-2) compatibility
FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates libgl1 git build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
# SAM 2: skip CUDA extension build in Docker for compatibility (SAM still works without it)
ENV SAM2_BUILD_CUDA=0
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Pre-download SAM 2.1 checkpoint at build time (no GPU needed; just downloads the file)
ENV HF_HOME=/models/hf_cache
ENV HUGGINGFACE_HUB_CACHE=/models/hf_cache
RUN mkdir -p /models/hf_cache \
    && python -c "from huggingface_hub import hf_hub_download; hf_hub_download(repo_id='facebook/sam2.1-hiera-small', filename='sam2.1_hiera_small.pt'); print('SAM 2 checkpoint downloaded.')"

COPY app.py ./
COPY utils.py ./

ENV FLASK_APP=app.py
ENV FLASK_RUN_HOST=0.0.0.0
ENV SAM2_MODEL_ID=facebook/sam2.1-hiera-small

EXPOSE 8081

CMD ["gunicorn", "-b", "0.0.0.0:8081", "app:app", "--workers", "1", "--timeout", "120"]
