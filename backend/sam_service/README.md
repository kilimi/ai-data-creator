# Unified SAM service (SAM 2 + SAM 3)

One Docker service runs both **SAM 2** (point prompts) and **SAM 3** (point / box / text prompts).

- **SAM 2**: Loaded from Hugging Face at startup (`facebook/sam2.1-hiera-small`). No extra setup.
- **SAM 3**: By default you must provide a **local checkpoint**. The UI reports SAM 3 as unavailable until the file exists. Optional: enable Hugging Face download (see below).

## Local SAM 3 checkpoint (recommended for installs)

1. Download the SAM 3 checkpoint (e.g. `sam3.pt` from [Hugging Face](https://huggingface.co/facebook/sam3) or [GitHub](https://github.com/facebookresearch/sam3)).
2. Choose a **host folder** and filename via **`lai install`** / **`lai install-gui`** (written to `.env` as `SAM3_MODELS_HOST_PATH` and `SAM3_CHECKPOINT_FILENAME`). Default folder is `backend/sam_service/models/` under the repo; default filename `sam3.pt`.
3. Compose mounts that host folder at `/models/sam3` in the container; `SAM3_CHECKPOINT_PATH` points at `/models/sam3/<filename>`.
4. Restart `sam_service` after adding or moving the file.

If the checkpoint is missing, **`sam3_available` in GET /health is false** and the annotator only offers SAM 2.

## Hugging Face download instead of a local file (opt-in)

Set **`SAM3_ALLOW_HF_DOWNLOAD=true`** (e.g. in `.env` and pass through compose). Then the service may download SAM 3 on first use; use **`HF_TOKEN`** if the model repo is gated.

## API

- **GET /health**  
  Returns `{ "status": "ok", "sam_available": true/false, "sam3_available": true/false }`.  
  `sam3_available` is true only when SAM 3 code loads **and** (local checkpoint exists **or** `SAM3_ALLOW_HF_DOWNLOAD=true`).

- **POST /segment**  
  Body: `imageB64` or `imageUrl`, optional `point` / `points`, and **`model`**: `"sam2"` (default) or `"sam3"`.  
  For SAM 3 you can also pass `text` for text-prompt segmentation.  
  Response: `{ "polygons", "maskBase64", "source": "sam2"|"sam3" }`.

- **POST /segment/text**  
  SAM 3 only: body with `imageB64` or `imageUrl` and `text`. Same response shape.

## Environment

| Variable | Description |
|----------|-------------|
| `SAM2_MODEL_ID` | Hugging Face model id for SAM 2 (default: facebook/sam2.1-hiera-small) |
| `SAM3_CHECKPOINT_PATH` | Path to local SAM 3 checkpoint (default: /models/sam3/sam3.pt when volume is mounted) |
| `SAM3_ALLOW_HF_DOWNLOAD` | If `true`, allow loading SAM 3 from Hugging Face when no local file (default: `false`) |
| `HF_TOKEN` | Hugging Face token (for gated downloads / HF path when `SAM3_ALLOW_HF_DOWNLOAD=true`) |
| `SAM_MAX_SIZE` | Max side length for inference (default 1024) |
| `SAM3_POINT_BOX_PADDING` | Padding (px) when converting point to box for SAM 3 (default 10) |
