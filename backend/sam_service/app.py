import os
from flask import Flask, request, jsonify
from PIL import Image, ImageDraw
import numpy as np
import requests
import io

from utils import decode_base64_image, encode_image_to_dataurl, mask_to_polygons

# Try to import segment-anything (SAM) and prepare a predictor
SAM_AVAILABLE = False
SAM_PREDICTOR = None
SAM_DEVICE = 'cpu'

try:
    from segment_anything import sam_model_registry, SamPredictor
    import torch
    SAM_AVAILABLE = True
    SAM_DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
    # Load model at runtime when first request arrives to avoid heavy startup during build
except Exception:
    SAM_AVAILABLE = False

app = Flask(__name__)

# Try to import a SAM implementation if available
try:
    # from segment_anything import SamPredictor, sam_model_registry
    SAM_AVAILABLE = False
except Exception:
    SAM_AVAILABLE = False


@app.route('/segment', methods=['POST'])
def segment():
    data = request.get_json(force=True)
    image_url = data.get('imageUrl')
    image_b64 = data.get('imageB64')
    point = data.get('point') or {}

    if image_url:
        try:
            r = requests.get(image_url, timeout=10)
            r.raise_for_status()
            img = Image.open(io.BytesIO(r.content)).convert('RGBA')
        except Exception as e:
            return jsonify({'error': f'Failed to fetch image: {e}'}), 400
    elif image_b64:
        try:
            img = decode_base64_image(image_b64)
        except Exception as e:
            return jsonify({'error': f'Failed to decode image: {e}'}), 400
    else:
        return jsonify({'error': 'No image provided'}), 400

    # If SAM is available, ensure model is loaded and run prediction around the point
    if SAM_AVAILABLE:
        try:
            model_path = os.environ.get('SAM_WEIGHTS', '/models/sam2.1_hiera_small.pt')
            global SAM_PREDICTOR
            if SAM_PREDICTOR is None:
                # instantiate model
                # choose model type that matches the checkpoint (use "default" registry if uncertain)
                sam = sam_model_registry.get('default', model_path)
                sam.to(SAM_DEVICE)
                SAM_PREDICTOR = SamPredictor(sam)

            # Prepare image for predictor (expects numpy HxWx3 RGB)
            img_rgb = img.convert('RGB')
            img_np = np.array(img_rgb)
            SAM_PREDICTOR.set_image(img_np)

            # Build input point in XY order expected by predictor: (x, y)
            input_point = np.array([[int(point.get('x', img.width//2)), int(point.get('y', img.height//2))]])
            input_label = np.array([1])

            # Run prediction (use default values)
            masks, scores, logits = SAM_PREDICTOR.predict(point_coords=input_point, point_labels=input_label, multimask_output=False)

            # masks is boolean HxW array (or array of masks). Convert first mask to polygons
            mask_np = (masks[0].astype('uint8') * 255) if masks is not None and len(masks) > 0 else np.zeros((img.height, img.width), dtype='uint8')
            polygons = mask_to_polygons(mask_np)
            mask_img = Image.fromarray(mask_np).convert('RGBA')
            mask_dataurl = encode_image_to_dataurl(mask_img)

            polys_out = [[[int(x), int(y)] for (x,y) in poly] for poly in polygons]
            return jsonify({'polygons': polys_out, 'maskBase64': mask_dataurl})
        except Exception as e:
            # Fallback to heuristic if SAM inference fails
            print('SAM inference error:', e)

    # If SAM is not available or inference failed, return a simple heuristic: a centered rectangle or a circle around point
    w, h = img.size
    cx = int(point.get('x', w//2))
    cy = int(point.get('y', h//2))
    box_w = int(min(w, h) * 0.3)
    box_h = int(min(w, h) * 0.3)

    left = max(0, cx - box_w//2)
    top = max(0, cy - box_h//2)
    right = min(w, cx + box_w//2)
    bottom = min(h, cy + box_h//2)

    mask = Image.new('L', (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle([left, top, right, bottom], fill=255)

    mask_np = np.array(mask)
    polygons = mask_to_polygons(mask_np)
    mask_dataurl = encode_image_to_dataurl(mask.convert('RGBA'))

    polys_out = [[[int(x), int(y)] for (x,y) in poly] for poly in polygons]
    return jsonify({'polygons': polys_out, 'maskBase64': mask_dataurl})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8081)))
