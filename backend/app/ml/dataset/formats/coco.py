"""COCO format dataset writer for MMYOLO."""
from __future__ import annotations

import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List

from app.ml.dataset.builder import generate_safe_output_filename

logger = logging.getLogger(__name__)


def prepare_coco_dataset(
    db,
    dataset_configs: List[Dict[str, Any]],
    output_dir: Path,
    task: str = "detect",
    remove_images_without_annotations: bool = True,
) -> Dict[str, Any]:
    """
    Prepare COCO JSON format dataset for MMYOLO/RTMDet training.

    Unlike YOLO .txt format, MMYOLO expects COCO JSON files:
      output_dir/annotations/train.json
      output_dir/annotations/val.json   (if val split > 0)
      output_dir/images/train/
      output_dir/images/val/

    Returns dict with keys:
      train_json, val_json (optional), class_names, class_count, image_counts
    """
    from app.models import Dataset, Image, Annotation, AnnotationClass, AnnotationFile, ImageCollection
    from app.tasks.yolo_training_helpers import generate_safe_output_filename

    annotations_dir = output_dir / "annotations"
    train_images_dir = output_dir / "images" / "train"
    val_images_dir = output_dir / "images" / "val"
    annotations_dir.mkdir(parents=True, exist_ok=True)
    train_images_dir.mkdir(parents=True, exist_ok=True)
    val_images_dir.mkdir(parents=True, exist_ok=True)

    # ── 1. Collect unique class names across all configs ──────────────────────
    all_classes: set = set()
    for config in dataset_configs:
        annotation_file_id = config["annotation_file_id"]
        ann_classes = db.query(AnnotationClass).filter(
            AnnotationClass.annotation_file_id == annotation_file_id
        ).all()
        if not ann_classes:
            ann_file = db.query(AnnotationFile).filter(
                AnnotationFile.dataset_id == config["dataset_id"]
            ).first()
            if ann_file:
                ann_classes = db.query(AnnotationClass).filter(
                    AnnotationClass.annotation_file_id == ann_file.id
                ).all()
        for c in ann_classes:
            all_classes.add(c.class_name)

    sorted_classes = sorted(all_classes)
    class_mapping = {name: idx for idx, name in enumerate(sorted_classes)}
    coco_categories = [
        {"id": idx + 1, "name": name, "supercategory": "object"}
        for idx, name in enumerate(sorted_classes)
    ]

    # ── 2. Build per-split COCO structures ────────────────────────────────────
    splits_data: Dict[str, Dict] = {
        "train": {"images": [], "annotations": [], "categories": coco_categories},
        "val": {"images": [], "annotations": [], "categories": coco_categories},
    }
    image_counts = {"train": 0, "val": 0}
    global_img_id = 1
    global_ann_id = 1
    has_any_segmentation = False

    for config in dataset_configs:
        dataset_id = config["dataset_id"]
        annotation_file_id = config["annotation_file_id"]
        image_collection = config.get("image_collection")
        split_pct = config.get("split", {"train": 80, "val": 20, "test": 0})

        dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            logger.warning(f"Dataset {dataset_id} not found, skipping")
            continue

        images_query = db.query(Image).filter(Image.dataset_id == dataset_id)
        if image_collection:
            images_query = images_query.join(Image.collection).filter(
                ImageCollection.name == image_collection
            )
        images = images_query.all()

        if not images:
            logger.warning(f"No images in dataset {dataset_id}, skipping")
            continue

        # Optionally filter images without valid annotations
        if remove_images_without_annotations:
            needs_seg = task in ("segment", "oriented")
            filtered = []
            for img in images:
                anns = db.query(Annotation).filter(
                    Annotation.image_id == img.id,
                    Annotation.annotation_file_id == annotation_file_id,
                ).all()
                for a in anns:
                    has_bbox = a.bbox or (a.bbox_x is not None and a.bbox_width is not None)
                    has_seg = a.segmentation and len(a.segmentation) > 0
                    if needs_seg and has_seg and has_bbox:
                        filtered.append(img)
                        break
                    if not needs_seg and has_bbox:
                        filtered.append(img)
                        break
            images = filtered

        if not images:
            logger.warning(f"No images with valid annotations in dataset {dataset_id}, skipping")
            continue

        total = len(images)
        train_n = int(total * split_pct.get("train", 80) / 100)
        val_n = int(total * split_pct.get("val", 20) / 100)
        # Integer percent splits can drop images (e.g. 12 @ 80/20 → 9 train + 2 val, 1 lost).
        # Put any rounding remainder on train (COCO export has no test split; matches YOLO when test=0).
        split_assignments = (
            [("train", img) for img in images[:train_n]]
            + [("val", img) for img in images[train_n : train_n + val_n]]
            + [("train", img) for img in images[train_n + val_n :]]
        )

        for split_name, image in split_assignments:
            dst_dir = train_images_dir if split_name == "train" else val_images_dir

            # Copy image file
            if image.url and image.url.startswith("/static/projects/"):
                src_path = Path("projects") / image.url.replace("/static/projects/", "")
            elif image.url and image.url.startswith("projects/"):
                src_path = Path(image.url)
            else:
                src_path = Path("projects") / str(dataset_id) / image.file_name

            safe_filename = generate_safe_output_filename(src_path.name, image.dataset_id)
            dst_path = dst_dir / safe_filename

            if src_path.exists() and not dst_path.exists():
                try:
                    os.link(src_path, dst_path)
                except OSError:
                    shutil.copy2(src_path, dst_path)

            # Get image dimensions with fallback to actual file reading
            img_width = image.width
            img_height = image.height
            if not img_width or not img_height or img_width <= 0 or img_height <= 0:
                try:
                    from PIL import Image as PILImage
                    with PILImage.open(dst_path) as pil_img:
                        img_width, img_height = pil_img.size
                    logger.info(f"Read image dimensions from file {dst_path}: {img_width}x{img_height}")
                except Exception as dim_err:
                    logger.warning(f"Could not read image dimensions for {dst_path}: {dim_err}")
                    img_width, img_height = 640, 640  # Safe fallback
            
            coco_img = {
                "id": global_img_id,
                "file_name": safe_filename,
                "width": img_width,
                "height": img_height,
            }
            splits_data[split_name]["images"].append(coco_img)
            image_counts[split_name] += 1

            # Annotations
            anns = db.query(Annotation).filter(
                Annotation.image_id == image.id,
                Annotation.annotation_file_id == annotation_file_id,
            ).all()

            for ann in anns:
                # Validate category_id before lookup
                if ann.category_id is None:
                    logger.warning(f"Annotation {ann.id} has no category_id, skipping")
                    continue
                
                ann_class = db.query(AnnotationClass).filter(
                    AnnotationClass.annotation_file_id == annotation_file_id,
                    AnnotationClass.category_id == ann.category_id,
                ).first()
                if not ann_class:
                    logger.warning(
                        f"No AnnotationClass found for annotation {ann.id} "
                        f"(category_id={ann.category_id}, annotation_file_id={annotation_file_id})"
                    )
                    continue
                cat_id = class_mapping.get(ann_class.class_name)
                if cat_id is None:
                    logger.warning(f"Class name '{ann_class.class_name}' not in class_mapping")
                    continue
                coco_cat_id = cat_id + 1  # COCO categories are 1-indexed

                # Extract bbox in [x, y, w, h] COCO format
                bbox_coco = None
                if ann.bbox and isinstance(ann.bbox, list) and len(ann.bbox) == 4:
                    bbox_coco = [float(v) for v in ann.bbox]
                elif ann.bbox and isinstance(ann.bbox, dict):
                    bbox_coco = [
                        float(ann.bbox.get("x", 0)),
                        float(ann.bbox.get("y", 0)),
                        float(ann.bbox.get("width", 0)),
                        float(ann.bbox.get("height", 0)),
                    ]
                elif ann.bbox_x is not None and ann.bbox_width is not None:
                    bbox_coco = [
                        float(ann.bbox_x),
                        float(ann.bbox_y or 0),
                        float(ann.bbox_width),
                        float(ann.bbox_height or 0),
                    ]

                # Segmentation polygon with proper validation
                seg_poly = None
                if ann.segmentation and len(ann.segmentation) > 0:
                    try:
                        raw = ann.segmentation
                        # Bounds check before accessing raw[0]
                        if isinstance(raw, list) and len(raw) > 0:
                            poly = raw[0] if isinstance(raw[0], list) else raw
                        else:
                            poly = raw
                        
                        # Validate polygon has enough points and all are numeric
                        if isinstance(poly, list) and len(poly) >= 6:
                            # Verify all coordinates are numeric
                            if all(isinstance(coord, (int, float)) for coord in poly):
                                seg_poly = [poly]
                                has_any_segmentation = True
                            else:
                                logger.warning(
                                    f"Annotation {ann.id}: segmentation polygon contains non-numeric values"
                                )
                        else:
                            logger.debug(
                                f"Annotation {ann.id}: segmentation polygon too short (len={len(poly) if isinstance(poly, list) else 0})"
                            )
                    except Exception as seg_err:
                        logger.warning(f"Annotation {ann.id}: failed to process segmentation: {seg_err}")

                if task == "segment":
                    if seg_poly is None or bbox_coco is None:
                        continue
                elif task == "oriented":
                    if seg_poly is None:
                        continue
                else:  # detect
                    if bbox_coco is None:
                        continue

                area = (bbox_coco[2] * bbox_coco[3]) if bbox_coco else 0.0
                coco_ann: Dict[str, Any] = {
                    "id": global_ann_id,
                    "image_id": global_img_id,
                    "category_id": coco_cat_id,
                    "bbox": bbox_coco or [0, 0, 0, 0],
                    "area": area,
                    "iscrowd": 0,
                }
                if seg_poly is not None:
                    coco_ann["segmentation"] = seg_poly
                else:
                    coco_ann["segmentation"] = []

                splits_data[split_name]["annotations"].append(coco_ann)
                global_ann_id += 1

            global_img_id += 1

    # ── 3. Validate ───────────────────────────────────────────────────────────
    if not sorted_classes:
        raise ValueError("No annotation classes found. Make sure your datasets have annotations with classes defined.")

    total_train = len(splits_data["train"]["images"])
    total_val = len(splits_data["val"]["images"])
    if total_train == 0 and total_val == 0:
        raise ValueError("No images were processed. Check that your datasets have images with valid annotations.")

    if task == "segment" and not has_any_segmentation:
        raise ValueError(
            "Task 'segment' requires segmentation (polygon) annotations, but none were found. "
            "Add polygon annotations or switch to task 'detect'."
        )

    # ── 4. Write JSON files ───────────────────────────────────────────────────
    train_json_path = annotations_dir / "train.json"
    with open(train_json_path, "w") as f:
        json.dump(splits_data["train"], f)

    result: Dict[str, Any] = {
        "train_json": str(train_json_path),
        "class_names": sorted_classes,
        "class_count": len(sorted_classes),
        "image_counts": image_counts,
    }

    if total_val > 0:
        val_json_path = annotations_dir / "val.json"
        with open(val_json_path, "w") as f:
            json.dump(splits_data["val"], f)
        result["val_json"] = str(val_json_path)

    logger.info(
        f"MMYOLO dataset prepared: {total_train} train, {total_val} val images, "
        f"{len(sorted_classes)} classes, task={task}"
    )
    return result