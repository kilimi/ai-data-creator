FROM pytorch/pytorch:2.2.0-cuda12.1-cudnn8-runtime

# Use CUDA-enabled PyTorch base so SAM inference can use GPUs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates libgl1 git build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
# The base image already contains torch; install the other Python deps
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY app.py ./
COPY utils.py ./

# Download SAM v2 model weights into /models during build so the container can run without a pre-mounted folder.
RUN mkdir -p /models \
    && curl -fsSL -o /models/sam2.1_hiera_tiny.pt https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt \
    && curl -fsSL -o /models/sam2.1_hiera_small.pt https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt || true


        #&& curl -fsSL -o /models/sam2.1_hiera_large.pt https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt \
    #&& curl -fsSL -o /models/sam2.1_hiera_base_plus.pt https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt 
ENV FLASK_APP=app.py
ENV FLASK_RUN_HOST=0.0.0.0
ENV SAM_WEIGHTS=/models/sam2.1_hiera_small.pt

EXPOSE 8081

CMD ["gunicorn", "-b", "0.0.0.0:8081", "app:app", "--workers", "1"]
