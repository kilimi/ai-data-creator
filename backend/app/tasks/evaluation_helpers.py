"""Shared helpers for model evaluation (YOLO + MMYOLO)."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np

from app.models import Annotation, AnnotationFile, Image

logger = logging.getLogger(__name__)

MAX_CM_SAMPLES = 20


def load_ground_truth_annotations(
    db,
    annotation_file_id: Optional[str],
    class_names: List[str],
) -> Tuple[bool, Dict[int, List[dict]]]:
    """Build image_id -> list of GT boxes in xyxy pixel coordinates."""
    if not annotation_file_id:
        return False, {}

    annotation_file = db.query(AnnotationFile).filter(AnnotationFile.id == annotation_file_id).first()
    if not annotation_file:
        logger.warning("Annotation file %s not found", annotation_file_id)
        return False, {}

    annotations = db.query(Annotation).filter(Annotation.annotation_file_id == annotation_file_id).all()
    logger.info("Loading %s ground truth annotations from %s", len(annotations), annotation_file_id)

    ann_image_ids = {ann.image_id for ann in annotations}
    image_dims = {
        img.id: (img.width or 1, img.height or 1)
        for img in db.query(Image).filter(Image.id.in_(ann_image_ids)).all()
    }

    ground_truth: Dict[int, List[dict]] = {}
    for ann in annotations:
        if ann.image_id not in ground_truth:
            ground_truth[ann.image_id] = []

        img_w, img_h = image_dims.get(ann.image_id, (1, 1))
        bbox_x = bbox_y = bbox_width = bbox_height = None

        if (
            ann.bbox_x is not None
            and ann.bbox_y is not None
            and ann.bbox_width is not None
            and ann.bbox_height is not None
        ):
            bbox_x = ann.bbox_x * img_w
            bbox_y = ann.bbox_y * img_h
            bbox_width = ann.bbox_width * img_w
            bbox_height = ann.bbox_height * img_h
        elif ann.bbox and isinstance(ann.bbox, list) and len(ann.bbox) >= 4:
            bbox_x, bbox_y, bbox_width, bbox_height = ann.bbox[0], ann.bbox[1], ann.bbox[2], ann.bbox[3]

        if bbox_x is None or bbox_y is None or bbox_width is None or bbox_height is None:
            logger.warning("Skipping annotation %s with incomplete bbox data", ann.id)
            continue

        class_id = -1
        if ann.category:
            ann_cat_lower = ann.category.lower()
            for idx_cn, cn in enumerate(class_names):
                if cn.lower() == ann_cat_lower:
                    class_id = idx_cn
                    break
            if class_id == -1:
                logger.warning(
                    "GT category '%s' not found in training class_names %s",
                    ann.category,
                    class_names,
                )

        ground_truth[ann.image_id].append(
            {
                "class_id": class_id,
                "bbox": [bbox_x, bbox_y, bbox_x + bbox_width, bbox_y + bbox_height],
            }
        )

    return True, ground_truth


def accumulate_image_metrics(
    *,
    img: Image,
    image_predictions: List[Dict[str, Any]],
    ground_truth_annotations: Dict[int, List[dict]],
    has_ground_truth: bool,
    class_names: List[str],
    num_classes: int,
    ignored_class_ids: Set[int],
    iou_threshold: float,
    confusion_matrix: np.ndarray,
    cm_samples: Dict[str, List[dict]],
    counters: Dict[str, int],
    calculate_iou,
) -> None:
    """Update confusion matrix and TP/FP/FN counters for one image."""

    def _add_cm_sample(row: int, col: int, sample: dict) -> None:
        key = f"{row}_{col}"
        if key not in cm_samples:
            cm_samples[key] = []
        if len(cm_samples[key]) < MAX_CM_SAMPLES:
            cm_samples[key].append(sample)

    if has_ground_truth and img.id in ground_truth_annotations:
        gt_boxes = ground_truth_annotations[img.id]
        pred_boxes = [
            {"class_id": pred["class_id"], "bbox": pred["bbox_xyxy"], "conf": pred["conf"]}
            for pred in image_predictions
        ]

        filtered_pred_boxes = [p for p in pred_boxes if p["class_id"] not in ignored_class_ids]
        filtered_gt_boxes = [
            g for g in gt_boxes if g["class_id"] not in ignored_class_ids and g["class_id"] >= 0
        ]

        matched_gt: Set[int] = set()
        matched_pred: Set[int] = set()

        for i, pred in enumerate(filtered_pred_boxes):
            best_iou = 0.0
            best_gt_idx = -1
            for j, gt in enumerate(filtered_gt_boxes):
                if j in matched_gt:
                    continue
                iou = calculate_iou(pred["bbox"], gt["bbox"])
                if iou > best_iou:
                    best_iou = iou
                    best_gt_idx = j

            if best_iou >= iou_threshold and best_gt_idx >= 0:
                matched_pred.add(i)
                matched_gt.add(best_gt_idx)
                gt_class = filtered_gt_boxes[best_gt_idx]["class_id"]
                pred_class = pred["class_id"]
                if gt_class >= 0 and pred_class >= 0:
                    confusion_matrix[gt_class][pred_class] += 1
                    _add_cm_sample(
                        gt_class,
                        pred_class,
                        {
                            "image_id": img.id,
                            "file_name": img.file_name,
                            "pred_bbox": pred["bbox"],
                            "gt_bbox": filtered_gt_boxes[best_gt_idx]["bbox"],
                            "pred_class_name": class_names[pred_class],
                            "gt_class_name": class_names[gt_class],
                            "conf": float(pred["conf"]),
                            "iou": float(best_iou),
                        },
                    )
                    if gt_class == pred_class:
                        counters["true_positives"] += 1
                    else:
                        counters["false_positives"] += 1
            else:
                counters["false_positives"] += 1
                if pred["class_id"] < num_classes:
                    confusion_matrix[num_classes][pred["class_id"]] += 1
                    _add_cm_sample(
                        num_classes,
                        pred["class_id"],
                        {
                            "image_id": img.id,
                            "file_name": img.file_name,
                            "pred_bbox": pred["bbox"],
                            "gt_bbox": None,
                            "pred_class_name": class_names[pred["class_id"]],
                            "gt_class_name": "background",
                            "conf": float(pred["conf"]),
                            "iou": float(best_iou),
                        },
                    )

        for j in range(len(filtered_gt_boxes)):
            if j not in matched_gt:
                gt_class = filtered_gt_boxes[j]["class_id"]
                if 0 <= gt_class < num_classes:
                    confusion_matrix[gt_class][num_classes] += 1
                    _add_cm_sample(
                        gt_class,
                        num_classes,
                        {
                            "image_id": img.id,
                            "file_name": img.file_name,
                            "pred_bbox": None,
                            "gt_bbox": filtered_gt_boxes[j]["bbox"],
                            "pred_class_name": "background",
                            "gt_class_name": class_names[gt_class],
                            "conf": 0.0,
                            "iou": 0.0,
                        },
                    )
        counters["false_negatives"] += len(filtered_gt_boxes) - len(matched_gt)

    elif has_ground_truth:
        counters["false_positives"] += sum(
            1 for p in image_predictions if p["class_id"] not in ignored_class_ids
        )
