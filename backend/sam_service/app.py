"""
Unified SAM service: Segment Anything Model 2 and 3 in one container.
- SAM 2: point-prompt segmentation (facebookresearch/sam2).
- SAM 3: point / box / text prompts (facebookresearch/sam3).
POST /segment accepts "model": "sam2" | "sam3" (default sam2). GET /health returns both flags.
"""
import os
import hashlib
from flask import Flask, request, jsonify
from PIL import Image
import numpy as np
import requests
import io

from utils import decode_base64_image, encode_image_to_dataurl, mask_to_polygons

import torch  # used by both SAM 2 and SAM 3

# SAM 3 first (in case SAM 2’s imports affect it)
SAM3_AVAILABLE = False
SAM3_MODEL = None
SAM3_PROCESSOR = None
SAM3_LAST_IMAGE_HASH = None
SAM3_LAST_STATE = None
_build_sam3_image_model = None
_Sam3Processor = None

try:
    from sam3.model_builder import build_sam3_image_model as _build_sam3_image_model_fn
    from sam3.model.sam3_image_processor import Sam3Processor as _Sam3ProcessorCls
    _build_sam3_image_model = _build_sam3_image_model_fn
    _Sam3Processor = _Sam3ProcessorCls
    SAM3_AVAILABLE = True
    print("[SAM3] Import OK")
except Exception as e:
    print("[SAM3] Import failed:", e)
    import traceback
    traceback.print_exc()
    SAM3_AVAILABLE = False

# SAM 2
SAM_AVAILABLE = False
SAM_PREDICTOR = None
SAM_LAST_IMAGE_HASH = None

try:
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    SAM_AVAILABLE = True
except Exception as e:
    print("[SAM2] Import failed:", e)
    SAM_AVAILABLE = False

app = Flask(__name__)

# Log SAM 3 checkpoint path at startup (volume mount: backend/sam_service/models -> /models/sam3)
_sam3_path = os.environ.get("SAM3_CHECKPOINT_PATH", "").strip() or None
if _sam3_path:
    _exists = os.path.isfile(_sam3_path)
    print(f"[SAM3] SAM3_CHECKPOINT_PATH={_sam3_path}, exists={_exists}")
    if not _exists:
        print("[SAM3] Put sam3.pt in backend/sam_service/models/sam3.pt and run compose from backend/")
else:
    print("[SAM3] SAM3_CHECKPOINT_PATH not set")

MAX_INFER_SIZE = int(os.environ.get("SAM_MAX_SIZE", "1024"))
DEFAULT_MODEL_ID = os.environ.get("SAM2_MODEL_ID", "facebook/sam2.1-hiera-small")
POINT_BOX_PADDING = int(os.environ.get("SAM3_POINT_BOX_PADDING", "10"))


def _get_device():
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


# ---------- SAM 2 ----------
def _load_sam2_predictor():
    global SAM_PREDICTOR
    if SAM_PREDICTOR is not None:
        return SAM_PREDICTOR
    device = _get_device()
    print(f"[SAM2] Loading model {DEFAULT_MODEL_ID} on {device}...")
    SAM_PREDICTOR = SAM2ImagePredictor.from_pretrained(DEFAULT_MODEL_ID)
    SAM_PREDICTOR.model.to(device)
    print("[SAM2] Model loaded.")
    return SAM_PREDICTOR


# ---------- SAM 3 ----------
def _load_sam3_model():
    global SAM3_MODEL, SAM3_PROCESSOR
    if SAM3_MODEL is not None:
        return SAM3_MODEL, SAM3_PROCESSOR
    device = _get_device()
    raw_path = os.environ.get("SAM3_CHECKPOINT_PATH", "").strip() or None
    if raw_path and os.path.isfile(raw_path):
        checkpoint_path = raw_path
        load_from_hf = False
        print("[SAM3] Loading from local checkpoint:", checkpoint_path)
    else:
        checkpoint_path = None
        load_from_hf = True
        if raw_path:
            print("[SAM3] Checkpoint not found at", raw_path, "- downloading from HF")
        else:
            print("[SAM3] Loading from Hugging Face (set SAM3_CHECKPOINT_PATH for local)")
    print("[SAM3] Loading on", device, "...")
    SAM3_MODEL = _build_sam3_image_model(checkpoint_path=checkpoint_path, load_from_HF=load_from_hf)
    SAM3_MODEL.to(device)
    SAM3_PROCESSOR = _Sam3Processor(SAM3_MODEL)
    print("[SAM3] Model loaded.")
    return SAM3_MODEL, SAM3_PROCESSOR


def _points_to_box(points, w, h, padding=None):
    pad = padding or POINT_BOX_PADDING
    if not points:
        return None
    xs = [float(p.get("x", 0)) for p in points]
    ys = [float(p.get("y", 0)) for p in points]
    xc = sum(xs) / len(xs)
    yc = sum(ys) / len(ys)
    x1 = max(0, xc - pad)
    y1 = max(0, yc - pad)
    x2 = min(w, xc + pad)
    y2 = min(h, yc + pad)
    if x2 <= x1 or y2 <= y1:
        x2 = min(w, x1 + pad * 2)
        y2 = min(h, y1 + pad * 2)
    return [x1, y1, x2, y2]


# ---------- Routes ----------
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "sam_available": SAM_AVAILABLE,
        "sam3_available": SAM3_AVAILABLE,
    }), 200


def _get_image_from_request(data):
    image_url = data.get("imageUrl")
    image_b64 = data.get("imageB64")
    if image_url:
        r = requests.get(image_url, timeout=10)
        r.raise_for_status()
        return Image.open(io.BytesIO(r.content)).convert("RGBA")
    if image_b64:
        return decode_base64_image(image_b64)
    return None


@app.route("/segment", methods=["POST"])
def segment():
    data = request.get_json(force=True)
    model = (data.get("model") or "sam2").strip().lower()
    if model == "sam3":
        data = {k: v for k, v in data.items() if k != "model"}
        return _segment_sam3(data)
    data = {k: v for k, v in data.items() if k != "model"}
    return _segment_sam2(data)


def _segment_sam2(data):
    img = _get_image_from_request(data)
    if img is None:
        return jsonify({"error": "No image provided"}), 400
    point = data.get("point") or {}
    points = data.get("points")
    orig_w, orig_h = img.size
    img_rgb = img.convert("RGB")
    img_np = np.array(img_rgb)

    if not SAM_AVAILABLE:
        return jsonify({"error": "SAM 2 not available", "detail": "SAM 2 could not be loaded."}), 503

    try:
        predictor = _load_sam2_predictor()
        global SAM_LAST_IMAGE_HASH
        current_hash = hashlib.sha256(img_np.tobytes()).hexdigest()
        if current_hash != SAM_LAST_IMAGE_HASH:
            predictor.set_image(img_np)
            SAM_LAST_IMAGE_HASH = current_hash

        if points and len(points) > 0:
            point_coords = np.array([[float(p.get("x", 0)), float(p.get("y", 0))] for p in points], dtype=np.float32)
            point_labels = np.array([int(p.get("label", 1)) for p in points], dtype=np.int32)
        else:
            px = float(point.get("x", orig_w // 2))
            py = float(point.get("y", orig_h // 2))
            point_coords = np.array([[px, py]], dtype=np.float32)
            point_labels = np.array([1], dtype=np.int32)

        with torch.inference_mode():
            masks_np, _, _ = predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                multimask_output=False,
                normalize_coords=True,
            )

        if masks_np is None or masks_np.size == 0:
            return jsonify({"error": "No mask produced"}), 500
        mask = (masks_np[0] > 0.0).astype(np.uint8) * 255
        polygons = mask_to_polygons(mask)
        polys_out = [[[int(x), int(y)] for (x, y) in poly] for poly in polygons]
        mask_pil = Image.fromarray(mask).convert("RGBA")
        mask_dataurl = encode_image_to_dataurl(mask_pil)
        return jsonify({"polygons": polys_out, "maskBase64": mask_dataurl, "source": "sam2"})
    except Exception as e:
        print("[SAM2] Inference error:", e)
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Segmentation failed", "detail": str(e)}), 500


def _segment_sam3(data):
    img = _get_image_from_request(data)
    if img is None:
        return jsonify({"error": "No image provided"}), 400
    point = data.get("point") or {}
    points = data.get("points")
    text_prompt = data.get("text")
    orig_w, orig_h = img.size
    img_rgb = img.convert("RGB")
    img_np = np.array(img_rgb)

    if not SAM3_AVAILABLE:
        return jsonify({
            "error": "SAM 3 not available",
            "detail": "SAM 3 could not be loaded (check logs and HF token or SAM3_CHECKPOINT_PATH).",
        }), 503

    try:
        model, processor = _load_sam3_model()
        global SAM3_LAST_IMAGE_HASH, SAM3_LAST_STATE
        current_hash = hashlib.sha256(img_np.tobytes()).hexdigest()
        if current_hash != SAM3_LAST_IMAGE_HASH or SAM3_LAST_STATE is None:
            inference_state = processor.set_image(img_rgb)
            SAM3_LAST_IMAGE_HASH = current_hash
            SAM3_LAST_STATE = inference_state
        else:
            inference_state = SAM3_LAST_STATE

        masks_np = None
        if text_prompt and isinstance(text_prompt, str) and text_prompt.strip():
            output = processor.set_text_prompt(state=inference_state, prompt=text_prompt.strip())
            masks_np = output.get("masks")
        if masks_np is None or (isinstance(masks_np, (list, tuple)) and len(masks_np) == 0):
            pts = points if points and len(points) > 0 else [point] if point else None
            box = _points_to_box(pts, orig_w, orig_h) if pts else None
            if box is not None:
                try:
                    output = processor.set_box_prompt(state=inference_state, box=box)
                    masks_np = output.get("masks") if isinstance(output, dict) else None
                except Exception:
                    pass
            if masks_np is None or (isinstance(masks_np, (list, tuple)) and len(masks_np) == 0):
                output = processor.set_text_prompt(state=inference_state, prompt="object")
                masks_np = output.get("masks")

        if masks_np is None or (isinstance(masks_np, (list, tuple)) and len(masks_np) == 0):
            return jsonify({"error": "No mask produced"}), 500

        mask = masks_np[0] if isinstance(masks_np, (list, tuple)) else masks_np
        if hasattr(mask, "cpu"):
            mask = mask.cpu().numpy()
        mask = np.asarray(mask)
        # SAM 3 can return (1, 1, H*W) or (1, H, W) or (0, H, W) when no mask; ensure we have data
        if mask.size == 0 or (mask.ndim >= 1 and mask.shape[0] == 0):
            return jsonify({"error": "No mask produced"}), 500
        mask = np.squeeze(mask)
        if mask.size == 0 or (mask.ndim >= 1 and mask.shape[0] == 0):
            return jsonify({"error": "No mask produced"}), 500
        while mask.ndim > 2:
            if mask.shape[0] == 0:
                return jsonify({"error": "No mask produced"}), 500
            mask = mask[0]
        if mask.ndim == 1:
            mask = mask.reshape(1, -1)
        mask = (mask > 0.5).astype(np.uint8) * 255
        # PIL requires 2D (H, W); force it in case of (1, 1, N) etc.
        mask = np.squeeze(mask)
        if mask.ndim == 1:
            mask = mask.reshape(1, -1)
        if mask.ndim > 2:
            mask = mask.reshape(mask.shape[0], -1)
        if mask.shape[0] != orig_h or mask.shape[1] != orig_w:
            mask_pil = Image.fromarray(mask).resize((orig_w, orig_h), Image.NEAREST)
            mask = np.array(mask_pil)

        polygons = mask_to_polygons(mask)
        polys_out = [[[int(x), int(y)] for (x, y) in poly] for poly in polygons]
        mask_pil = Image.fromarray(mask).convert("RGBA")
        mask_dataurl = encode_image_to_dataurl(mask_pil)
        return jsonify({"polygons": polys_out, "maskBase64": mask_dataurl, "source": "sam3"})
    except Exception as e:
        print("[SAM3] Inference error:", e)
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Segmentation failed", "detail": str(e)}), 500


@app.route("/segment/text", methods=["POST"])
def segment_text():
    """SAM 3 text-prompt only. Forwards to segment with model=sam3."""
    data = request.get_json(force=True)
    data["model"] = "sam3"
    data.setdefault("points", [])
    data.setdefault("point", {})
    return segment()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8081)))
