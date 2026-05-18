## Goal

Refactor the backend Docker image to be a slim, multi-stage build on top of an official PyTorch+CUDA base, stop baking model weights into the image, and surface model availability in the UI so users see what's installed and how to fetch more.

## 1. Backend: Multi-stage Dockerfile

Rewrite `backend/Dockerfile`:

- Stage 1 (`builder`, `python:3.11-slim`): install `gcc/g++/cmake`, run `pip install --prefix=/install -r requirements.txt` (drop torch/torchvision from this list — they come from the base).
- Stage 2 (`runtime`, `pytorch/pytorch:2.7.1-cuda12.6-cudnn9-runtime`): install only runtime apt deps (`libgl1`, `libglib2.0-0`, `curl`, `postgresql-client`), copy installed site-packages from builder, copy app code.
- Remove the `RUN python scripts/download_*` lines. Models live on a volume now.
- Update `backend/requirements.txt` to drop `torch>=2.0.0` and `torchvision>=0.15.0` (provided by base image).
- Apply the same multi-stage pattern to `backend/Dockerfile.training` (already on a CUDA base — convert to PyTorch base too for consistency).

Expected: backend image shrinks from ~15 GB to ~3–4 GB and builds in ~2 min instead of ~15 min.

## 2. Models as volumes

- Add `./models` and `./ai_models` bind volumes for `backend` and `celery_worker` in `backend/docker-compose.yml` (next to existing `projects` / `data` / `runs`):

```text
- ${LAI_DATA_DIR:-../.lai-data}/models:/app/models
- ${LAI_DATA_DIR:-../.lai-data}/ai_models:/app/ai_models
```

- Keep `scripts/download_ultralytics_models.py` and `scripts/download_depth_anything_models.py` but invoke them from a new helper, not from Docker build:
  - Add `make download-models LAI_PRETRAINED_MODELS=minimal LAI_DEPTH_MODELS=minimal` target that runs them inside the running `backend` container (`docker compose exec backend python scripts/download_*`).
  - Update `scripts/install.sh` wizard step: after `up`, ask "Download foundation models now? (minimal / all / skip)" and run the make target.
- Document that on-demand Ultralytics downloads still work automatically when a missing model is requested (existing behavior).

## 3. Backend: Model inventory endpoint

New `backend/app/routers/system.py` endpoint `GET /system/models`:

- Lists, for both Ultralytics and Depth-Anything, every model in the matrix from `app/foundation_models.py` with a `present: bool` (uses `model_weights_presence` helpers and `DEPTH_ONNX_NAMES`).
- Returns grouped sections:
  - `yolo`: `[{ file, name, arch, size, task, present, size_mb }]`
  - `depth`: `[{ file, variant, environment, present, size_mb }]`
  - `commands`: convenience CLI strings the UI can copy (`make download-models LAI_PRETRAINED_MODELS=yolo11n`, `docker compose exec backend python scripts/download_ultralytics_models.py`).
- Also returns paths (`/app/models`, `/app/ai_models`) so users know where the volume is mounted.

## 4. Frontend: "Available models" panel

- Add `src/utils/api.ts` helper `getAvailableModels()` calling `/system/models` via central ApiClient.
- New page `src/pages/SystemModels.tsx` reachable from a Help/Settings entry:
  - Two tables (YOLO foundation, Depth Anything) with present / missing status badges (green check, gray dash).
  - Footer card with the copy-pasteable `make download-models` and `docker compose exec ...` snippets, plus a short note: "Models live in `<LAI_DATA_DIR>/models` and `ai_models` on the host. Add more by re-running the command with a different `LAI_PRETRAINED_MODELS` value (e.g. `all`, `yolo11`, `yolo11n-seg.pt`)."
- In `AutoAnnotateModal` and `TrainModelModal`, when a selected base model is missing locally, show the existing `WEIGHTS_DOWNLOAD_NOTICE`-style hint plus a small "Manage models" link to the new page.
- Add a Help article `src/pages/help/articles/ModelsArticle.tsx` explaining the volume layout, the download command, on-demand fallback, and how to bring in custom `.pt` files (drop them in the volume).

## 5. Docs and cleanup

- Update `README.md` install steps: image is now slim by default; run `make download-models` once after `make up`.
- Update `lai/wizard.py` first-run flow to print the new model-download prompt and surface it in the GUI Help → Models entry.
- Remove `LAI_PRETRAINED_MODELS` / `LAI_DEPTH_MODELS` build args from compose; they remain runtime env vars passed to the download script.

## Technical notes

- Multi-stage `COPY --from=builder /install /usr/local` — keep prefix matching the base image's site-packages path (the PyTorch base uses `/opt/conda`; we'll `pip install --target=/install` and add it to `PYTHONPATH` instead, which is more portable across base images).
- `model_weights_presence.py` already checks `/app/models` and `/app/ai_models/depth_estimation` — no change needed beyond using it from the new endpoint.
- Backward compatibility: if the volume is empty on first boot, Ultralytics' built-in fetch still works at job runtime, so existing customers won't break.
- Tests: add a vitest for `getAvailableModels` shape and a small render test for `SystemModels.tsx`.

## Out of scope

- Pushing pre-built images to GHCR / Docker Hub (separate PR).
- CPU-only image variant.
- Compose profiles for opting out of MongoDB / SAM / Flower.
