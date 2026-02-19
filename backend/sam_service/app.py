"""
SAM service: Segment Anything Model 2 (SAM 2) for point-prompt segmentation.
Uses official facebookresearch/sam2 with SAM2ImagePredictor.
"""
import os
import hashlib
from flask import Flask, request, jsonify
from PIL import Image
import numpy as np
import requests
import io

from utils import decode_base64_image, encode_image_to_dataurl, mask_to_polygons

# SAM 2
SAM_AVAILABLE = False
SAM_PREDICTOR = None
SAM_LAST_IMAGE_HASH = None

try:
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    import torch
    SAM_AVAILABLE = True
except Exception as e:
    print("SAM 2 import failed:", e)
    SAM_AVAILABLE = False

app = Flask(__name__)

# Max side length for inference (smaller = faster)
MAX_INFER_SIZE = int(os.environ.get("SAM_MAX_SIZE", "1024"))
# HuggingFace model id for SAM 2.1 small (or set SAM2_MODEL_ID env)
DEFAULT_MODEL_ID = os.environ.get("SAM2_MODEL_ID", "facebook/sam2.1-hiera-small")


def _get_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def _load_predictor():
    """Load SAM 2 predictor from HuggingFace (downloads on first call)."""
    global SAM_PREDICTOR
    if SAM_PREDICTOR is not None:
        return SAM_PREDICTOR
    device = _get_device()
    print(f"[SAM] Loading model {DEFAULT_MODEL_ID} on {device}...")
    SAM_PREDICTOR = SAM2ImagePredictor.from_pretrained(DEFAULT_MODEL_ID)
    SAM_PREDICTOR.model.to(device)
    print("[SAM] Model loaded.")
    return SAM_PREDICTOR


@app.route("/health", methods=["GET"])
def health():
    """Health check for load balancers and frontend SAM availability."""
    return jsonify({"status": "ok", "sam_available": SAM_AVAILABLE}), 200


@app.route("/segment", methods=["POST"])
def segment():
    data = request.get_json(force=True)
    image_url = data.get("imageUrl")
    image_b64 = data.get("imageB64")
    point = data.get("point") or {}
    points = data.get("points")

    if image_url:
        try:
            r = requests.get(image_url, timeout=10)
            r.raise_for_status()
            img = Image.open(io.BytesIO(r.content)).convert("RGBA")
        except Exception as e:
            return jsonify({"error": f"Failed to fetch image: {e}"}), 400
    elif image_b64:
        try:
            img = decode_base64_image(image_b64)
        except Exception as e:
            return jsonify({"error": f"Failed to decode image: {e}"}), 400
    else:
        return jsonify({"error": "No image provided"}), 400

    orig_w, orig_h = img.size
    img_rgb = img.convert("RGB")
    img_np = np.array(img_rgb)

    if SAM_AVAILABLE:
        try:
            predictor = _load_predictor()
            device = predictor.model.device

            # Use same image hash to avoid re-encoding when image unchanged
            global SAM_LAST_IMAGE_HASH
            current_hash = hashlib.sha256(img_np.tobytes()).hexdigest()
            if current_hash != SAM_LAST_IMAGE_HASH:
                predictor.set_image(img_np)
                SAM_LAST_IMAGE_HASH = current_hash

            # Build point coords and labels (pixel coordinates; predictor normalizes internally)
            if points and len(points) > 0:
                point_coords = np.array(
                    [[float(p.get("x", 0)), float(p.get("y", 0))] for p in points],
                    dtype=np.float32,
                )
                point_labels = np.array(
                    [int(p.get("label", 1)) for p in points], dtype=np.int32
                )
            else:
                px = float(point.get("x", orig_w // 2))
                py = float(point.get("y", orig_h // 2))
                point_coords = np.array([[px, py]], dtype=np.float32)
                point_labels = np.array([1], dtype=np.int32)

            with torch.inference_mode():
                masks_np, iou_preds, _ = predictor.predict(
                    point_coords=point_coords,
                    point_labels=point_labels,
                    multimask_output=False,
                    normalize_coords=True,
                )

            # masks_np: (num_masks, H, W), values in [0, 1] or logits
            if masks_np is None or masks_np.size == 0:
                return jsonify({"error": "No mask produced"}), 500
            mask = (masks_np[0] > 0.0).astype(np.uint8) * 255
            polygons = mask_to_polygons(mask)
            polys_out = [[[int(x), int(y)] for (x, y) in poly] for poly in polygons]

            mask_pil = Image.fromarray(mask).convert("RGBA")
            mask_dataurl = encode_image_to_dataurl(mask_pil)
            return jsonify({
                "polygons": polys_out,
                "maskBase64": mask_dataurl,
                "source": "sam2",  # so frontend can distinguish from old rectangle fallback
            })
        except Exception as e:
            print("SAM 2 inference error:", e)
            import traceback
            traceback.print_exc()
            return (
                jsonify(
                    {
                        "error": "Segmentation failed",
                        "detail": str(e),
                    }
                ),
                500,
            )

    return (
        jsonify(
            {
                "error": "SAM not available",
                "detail": "Segment Anything Model 2 could not be loaded.",
            }
        ),
        503,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8081)))
