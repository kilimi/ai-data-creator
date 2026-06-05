"""Dataset domain services (extracted from datasets router)."""
from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
from fastapi import BackgroundTasks, HTTPException, UploadFile
from PIL import Image
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.database import SessionLocal
from app.services.dataset_schemas import ViewFiftyOneRequest
logger = logging.getLogger(__name__)

def _sanitize_fiftyone_field_name(name: str) -> str:
    """Sanitize annotation file name for use as FiftyOne field name."""
    base = os.path.splitext(name)[0] if name else "annotations"
    base = re.sub(r"[^a-zA-Z0-9_]", "_", base)
    return f"predictions_{base}" if base else "predictions"


def _depth_like_collection_name(name: Optional[str]) -> bool:
    if not name:
        return False
    n = name.lower()
    return bool(re.search(r"\bdepth\b", n)) or "depth map" in n or "depth-map" in n


def _effective_project_id(dataset: models.Dataset, images: List[models.Image]) -> int:
    if dataset.project_id:
        return int(dataset.project_id)
    for img in images:
        u = (img.url or "").replace("\\", "/")
        m = re.search(r"/projects/(\d+)/", u)
        if m:
            return int(m.group(1))
    return 0


def _pick_default_fiftyone_collection_id(db: Session, dataset_id: int) -> Optional[int]:
    cols = (
        db.query(models.ImageCollection)
        .filter(models.ImageCollection.dataset_id == dataset_id)
        .order_by(models.ImageCollection.is_default.desc(), models.ImageCollection.created_at.asc())
        .all()
    )
    if not cols:
        return None
    for c in cols:
        if c.is_default and not _depth_like_collection_name(c.name):
            return int(c.id)
    for c in cols:
        n = (c.name or "").lower()
        if ("rgb" in n or "color" in n or "visible" in n) and not _depth_like_collection_name(c.name):
            return int(c.id)
    for c in cols:
        if not _depth_like_collection_name(c.name):
            return int(c.id)
    return int(cols[0].id)


def _remap_annotation_image_to_layer(
    src: models.Image,
    target_collection_id: int,
    all_images: List[models.Image],
) -> models.Image:
    if src.collection_id == target_collection_id:
        return src
    if src.group_id:
        for t in all_images:
            if t.collection_id == target_collection_id and t.group_id and t.group_id == src.group_id:
                return t
    base = os.path.splitext(src.file_name or "")[0].lower()
    for t in all_images:
        if t.collection_id != target_collection_id:
            continue
        tb = os.path.splitext(t.file_name or "")[0].lower()
        if tb == base:
            return t
    return src


def _filesystem_path_for_image(img: models.Image, project_id: int, dataset_id: int) -> Optional[Path]:
    u = (img.url or "").replace("\\", "/")
    m = re.search(r"/projects/(\d+)/(\d+)/images/(.+)$", u)
    if m:
        rel = Path("projects") / m.group(1) / m.group(2) / "images" / m.group(3)
        for base in (Path("."), Path("/app")):
            cand = (base / rel).resolve()
            if cand.exists():
                return cand
    for root in (Path("projects"), Path("/app/projects")):
        cand = root / str(project_id) / str(dataset_id) / "images" / (img.file_name or "")
        if cand.exists():
            return cand.resolve()
    legacy = Path("data") / "images" / str(dataset_id) / (img.file_name or "")
    if legacy.exists():
        return legacy.resolve()
    return None


def _can_resolve_fiftyone_image(img: models.Image, project_id: int, dataset_id: int) -> bool:
    if _filesystem_path_for_image(img, project_id, dataset_id) is not None:
        return True
    for root in (Path("projects"), Path("/app/projects")):
        p = root / str(project_id) / str(dataset_id) / "images" / (img.file_name or "")
        if p.exists():
            return True
    legacy = Path("data") / "images" / str(dataset_id) / (img.file_name or "")
    return legacy.exists()


# was router.post("/datasets/{dataset_id}/annotations/view-fiftyone")
async def view_annotations_in_fiftyone(
    db: Session, dataset_id: int, body: ViewFiftyOneRequest
) -> dict:
    """Open selected annotation files in FiftyOne, shown as predictions (one field per file)."""
    logger = logging.getLogger(__name__)
    if not body.annotation_file_ids:
        raise HTTPException(status_code=400, detail="Select at least one annotation file")

    dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    images = db.query(models.Image).filter(models.Image.dataset_id == dataset_id).all()
    if not images:
        raise HTTPException(status_code=400, detail="No images in dataset")

    eff_project_id = _effective_project_id(dataset, images)
    by_id: dict = {str(img.id): img for img in images}

    target_col_id: Optional[int] = body.image_collection_id
    if target_col_id is not None:
        col = (
            db.query(models.ImageCollection)
            .filter(
                models.ImageCollection.id == target_col_id,
                models.ImageCollection.dataset_id == dataset_id,
            )
            .first()
        )
        if not col:
            raise HTTPException(status_code=400, detail="Invalid image collection for this dataset")
    else:
        target_col_id = _pick_default_fiftyone_collection_id(db, dataset_id)
        if target_col_id is None:
            raise HTTPException(status_code=400, detail="No image collections found for this dataset")

    # Per annotation file: field_name -> { display_image_id -> [ {label, bbox, confidence} ] }
    predictions_by_field = {}

    for af_id in body.annotation_file_ids:
        af = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == af_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        if not af:
            continue
        field_name = _sanitize_fiftyone_field_name(af.name or af_id[:8])
        annotations = db.query(models.Annotation).filter(
            models.Annotation.annotation_file_id == af_id,
            models.Annotation.dataset_id == dataset_id
        ).all()

        by_image = {}
        for ann in annotations:
            src_key = str(ann.image_id)
            src = by_id.get(src_key)
            if not src:
                continue
            disp = _remap_annotation_image_to_layer(src, int(target_col_id), images)
            disp_key = str(disp.id)

            w_src = float(src.width or 1) or 1.0
            h_src = float(src.height or 1) or 1.0
            w_disp = float(disp.width or 1) or 1.0
            h_disp = float(disp.height or 1) or 1.0

            x, y, ww, hh = None, None, None, None
            if ann.bbox_x is not None and ann.bbox_y is not None and ann.bbox_width is not None and ann.bbox_height is not None:
                x, y, ww, hh = ann.bbox_x, ann.bbox_y, ann.bbox_width, ann.bbox_height
            elif ann.bbox and isinstance(ann.bbox, list) and len(ann.bbox) >= 4:
                x, y, ww, hh = ann.bbox[0], ann.bbox[1], ann.bbox[2], ann.bbox[3]
            if x is None:
                continue

            if src.id != disp.id:
                sx = w_disp / w_src
                sy = h_disp / h_src
                x, y, ww, hh = x * sx, y * sy, ww * sx, hh * sy

            label = ann.category or "unknown"
            conf = float(ann.confidence) if ann.confidence is not None else 1.0
            bbox_norm = [x / w_disp, y / h_disp, ww / w_disp, hh / h_disp]
            if disp_key not in by_image:
                by_image[disp_key] = []
            by_image[disp_key].append({"label": label, "bbox": bbox_norm, "confidence": conf})

        predictions_by_field[field_name] = by_image

    if not predictions_by_field:
        raise HTTPException(status_code=400, detail="No valid annotation files or annotations found")

    needed_ids = set()
    for _fn, by_img in predictions_by_field.items():
        needed_ids.update(by_img.keys())

    image_dict = {}
    for iid in needed_ids:
        img = by_id.get(iid)
        if not img:
            continue
        fs = _filesystem_path_for_image(img, eff_project_id, dataset_id)
        entry = {
            "file_name": img.file_name,
            "width": img.width or 1,
            "height": img.height or 1,
        }
        if fs is not None:
            entry["fs_path"] = str(fs)
        image_dict[iid] = entry

    if not any(
        iid in by_id and _can_resolve_fiftyone_image(by_id[iid], eff_project_id, dataset_id)
        for iid in needed_ids
    ):
        raise HTTPException(
            status_code=400,
            detail="Could not find image files on disk for the selected layer. Check dataset paths and URLs.",
        )

    image_dict_b64 = base64.b64encode(json.dumps(image_dict).encode()).decode()
    predictions_b64 = base64.b64encode(json.dumps(predictions_by_field).encode()).decode()

    # Build script: one predictions field per annotation file (inside the image loop)
    field_blocks = []
    for fn in predictions_by_field:
        fn_esc = fn.replace("\\", "\\\\").replace("'", "\\'")
        field_blocks.append(f"    if '{fn_esc}' in predictions_by_field:")
        field_blocks.append(f"        by_img = predictions_by_field['{fn_esc}']")
        field_blocks.append("        if img_id in by_img:")
        field_blocks.append("            detections = []")
        field_blocks.append("            for pred in by_img[img_id]:")
        field_blocks.append("                d = fo.Detection(")
        field_blocks.append("                    label=pred['label'],")
        field_blocks.append("                    bounding_box=pred['bbox'],")
        field_blocks.append("                    confidence=pred['confidence'])")
        field_blocks.append("                detections.append(d)")
        field_blocks.append(f"            sample['{fn_esc}'] = fo.Detections(detections=detections)")

    script_content = f"""
import fiftyone as fo
import json
from pathlib import Path

dataset_name = "annotations_ds_{dataset_id}"
if dataset_name in fo.list_datasets():
    fo.delete_dataset(dataset_name)
dataset = fo.Dataset(dataset_name)
dataset.persistent = False

import base64 as _b64
image_dict = json.loads(_b64.b64decode('''{image_dict_b64}''').decode())
predictions_by_field = json.loads(_b64.b64decode('''{predictions_b64}''').decode())

_projects_root = Path("projects")
if not _projects_root.exists():
    _projects_root = Path("/app/projects")
_data_root = Path("data")

samples = []
for img_id, img_info in image_dict.items():
    img_path = None
    fp = img_info.get('fs_path')
    if fp:
        img_path = Path(fp)
    if not img_path or not img_path.exists():
        img_path = _projects_root / "{eff_project_id}" / "{dataset_id}" / "images" / img_info['file_name']
    if not img_path.exists():
        img_path = _data_root / "images" / "{dataset_id}" / img_info['file_name']
    if not img_path.exists():
        continue
    sample = fo.Sample(filepath=str(img_path))
"""
    script_content += "\n".join(field_blocks)
    script_content += """
    samples.append(sample)

dataset.add_samples(samples)
print(f"Loaded {len(samples)} samples, {len(predictions_by_field)} prediction fields")

import signal, sys
def _h(sig, frame): sys.exit(0)
signal.signal(signal.SIGINT, _h)
signal.signal(signal.SIGTERM, _h)
print('Launching FiftyOne app on port 5151...')
session = fo.launch_app(dataset, port=5151, address="0.0.0.0")
session.wait(-1)
"""

    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write(script_content)
            script_path = f.name
        process = subprocess.Popen(
            ["python", script_path],
            stdout=open("/tmp/fiftyone_stdout.log", "w"),
            stderr=open("/tmp/fiftyone_stderr.log", "w"),
            env={**os.environ, "FIFTYONE_DEFAULT_APP_PORT": "5151", "FIFTYONE_DEFAULT_APP_ADDRESS": "0.0.0.0"},
            start_new_session=True,
        )
        time.sleep(2)
        if process.poll() is not None:
            try:
                with open("/tmp/fiftyone_stderr.log") as ef:
                    err = ef.read()
                raise HTTPException(status_code=500, detail=f"FiftyOne failed: {err[:500]}")
            except FileNotFoundError:
                raise HTTPException(status_code=500, detail="FiftyOne failed to start")
        return {
            "success": True,
            "data": {
                "message": "FiftyOne is starting. Open http://localhost:5151 to view annotations as predictions.",
                "url": "http://localhost:5151",
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("view_annotations_in_fiftyone")
        raise HTTPException(status_code=500, detail=str(e))
