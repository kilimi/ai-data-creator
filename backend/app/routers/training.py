from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any, List
from datetime import datetime
import os
import json
import shutil
from pathlib import Path
import logging
import re
import tempfile
import uuid
import subprocess
import sys
import io
import zipfile

from ..database import get_db, SessionLocal
from ..models import Task, Dataset, AnnotationFile, Image, Annotation, AnnotationClass, ImageCollection, Project
from ..model_weights_presence import WEIGHTS_DOWNLOAD_NOTICE, is_training_base_weights_cached
from app.tasks.yolo_training_helpers import generate_safe_output_filename
from pydantic import BaseModel, field_validator, model_validator

router = APIRouter()
logger = logging.getLogger(__name__)

# Check if Celery is available
USE_CELERY = os.environ.get('USE_CELERY', 'true').lower() == 'true'
celery_train_task = None
celery_rtdetr_task = None
celery_mmyolo_task = None

if USE_CELERY:
    try:
        from app.tasks.training_tasks import train_yolo_model as celery_train_task
        from app.tasks.training_tasks import train_rtdetr_model as celery_rtdetr_task
        from app.tasks.training_tasks import train_mmyolo_model as celery_mmyolo_task
        logger.info("Celery task queue enabled for training")
    except ImportError as e:
        logger.warning(f"Celery not available: {e}. Set USE_CELERY=false to disable.")
        USE_CELERY = False


class YoloTrainingRequest(BaseModel):
    """Request model for YOLO training"""
    project_id: int
    dataset_configs: List[Dict[str, Any]]  # List of {dataset_id, annotation_file_id, image_collection, split: {train, val, test}}
    model_type: str = "yolo11n-seg.pt"  # YOLO model variant
    epochs: int = 100
    batch_size: int = 16
    image_size: int = 640
    device: str = "0"  # GPU device or "cpu"
    task_name: Optional[str] = None
    # Additional YOLO training parameters
    patience: int = 50
    optimizer: str = "auto"
    learning_rate: float = 0.01
    momentum: float = 0.937
    weight_decay: float = 0.0005
    save_period: int = -1  # -1 = only best and last, or save every N epochs
    augmentations: Optional[Dict[str, Any]] = None  # Augmentation settings
    remove_images_without_annotations: bool = True  # Remove images that have no annotations
    # Weights & Biases integration
    use_wandb: bool = False
    wandb_project: Optional[str] = None
    wandb_entity: Optional[str] = None

    @field_validator("model_type")
    @classmethod
    def _normalize_model_type(cls, v: str) -> str:
        raw = (v or "").strip()
        if not raw:
            return "yolo11n-seg.pt"
        if re.match(r"^yolo_?nas", raw, re.IGNORECASE):
            raise ValueError("YOLO-NAS models are no longer supported")
        return raw


class RTDETRTrainingRequest(BaseModel):
    """Request model for RT-DETR training"""
    project_id: int
    dataset_configs: List[Dict[str, Any]]
    model_type: str = "rtdetr-l.pt"  # RT-DETR model variant (rtdetr-l.pt or rtdetr-x.pt)
    epochs: int = 100
    batch_size: int = 16
    image_size: int = 640
    device: str = "0"
    task_name: Optional[str] = None
    # RT-DETR specific parameters
    patience: int = 50
    optimizer: str = "AdamW"
    learning_rate: float = 0.0001
    weight_decay: float = 0.0001
    save_period: int = -1  # -1 = only best and last, or save every N epochs
    # Weights & Biases integration
    use_wandb: bool = False
    wandb_project: Optional[str] = None
    wandb_entity: Optional[str] = None


# ── MMYOLO (OpenMMLab RTMDet family) ─────────────────────────────────────────

MMYOLO_VALID_ARCHS: frozenset = frozenset({"yolov8", "rtmdet", "rtmdet-ins", "rtmdet-r"})
MMYOLO_VALID_SIZES: frozenset = frozenset({"tiny", "s", "m", "l", "x"})


def mmyolo_config_name(arch: str, size: str) -> str:
    """Resolve (arch, size) → MMYolo config identifier used with `mim run mmyolo train`."""
    if arch not in MMYOLO_VALID_ARCHS:
        raise ValueError(f"Unknown MMYOLO arch '{arch}'. Valid: {sorted(MMYOLO_VALID_ARCHS)}")
    if size not in MMYOLO_VALID_SIZES:
        raise ValueError(f"Unknown MMYOLO size '{size}'. Valid: {sorted(MMYOLO_VALID_SIZES)}")
    if arch == "yolov8":
        # Official MMYOLO YOLOv8 config ids.
        return f"yolov8_{size}_syncbn_fast_8xb16-500e_coco"
    # Existing RTMDet-family short aliases are preserved for backward compatibility.
    return f"{arch}_{size}"


class MMYOLOTrainingRequest(BaseModel):
    """Request model for MMYOLO (YOLOv8 + RTMDet family) training."""
    project_id: int
    dataset_configs: List[Dict[str, Any]]
    arch: str = "rtmdet"          # yolov8 | rtmdet | rtmdet-ins | rtmdet-r
    size: str = "s"               # tiny | s | m | l | x
    task: str = "detect"          # detect | segment | oriented
    epochs: int = 300
    batch_size: int = 16
    image_size: int = 640
    device: str = "0"
    task_name: Optional[str] = None
    optimizer: str = "AdamW"
    learning_rate: float = 0.004
    weight_decay: float = 0.05
    save_period: int = -1
    remove_images_without_annotations: bool = True
    dji_patch_path: Optional[str] = None
    dji_use_widen_factor_025: bool = True
    use_wandb: bool = False
    wandb_project: Optional[str] = None
    wandb_entity: Optional[str] = None

    @field_validator("arch")
    @classmethod
    def _validate_arch(cls, v: str) -> str:
        if v not in MMYOLO_VALID_ARCHS:
            raise ValueError(f"arch must be one of {sorted(MMYOLO_VALID_ARCHS)}, got '{v}'")
        return v

    @field_validator("size")
    @classmethod
    def _validate_size(cls, v: str) -> str:
        if v not in MMYOLO_VALID_SIZES:
            raise ValueError(f"size must be one of {sorted(MMYOLO_VALID_SIZES)}, got '{v}'")
        return v

    @field_validator("task")
    @classmethod
    def _validate_task(cls, v: str) -> str:
        if v not in {"detect", "segment", "oriented"}:
            raise ValueError(f"task must be one of detect, segment, oriented, got '{v}'")
        return v

    @model_validator(mode="after")
    def _validate_arch_task_combo(self):
        if self.arch == "yolov8" and self.task != "detect":
            raise ValueError("arch 'yolov8' supports only task='detect'")
        return self


def prepare_mmyolo_dataset(
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

        split_assignments = (
            [("train", img) for img in images[:train_n]]
            + [("val", img) for img in images[train_n: train_n + val_n]]
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


# ── End MMYOLO helpers ────────────────────────────────────────────────────────


def _normalize_class_names(names: Any) -> List[str]:
    if isinstance(names, list):
        return [str(name) for name in names]
    if isinstance(names, dict):
        try:
            items = sorted(names.items(), key=lambda item: int(item[0]))
        except Exception:
            items = list(names.items())
        return [str(value) for _, value in items]
    return []


async def _read_import_classes(classes: Optional[UploadFile]) -> List[str]:
    if not classes:
        return []

    try:
        payload = json.loads((await classes.read()).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid classes.json: {exc}") from exc

    class_names: List[str] = []
    if isinstance(payload, list):
        class_names = [str(name) for name in payload]
    elif isinstance(payload, dict):
        if "class_names" in payload:
            class_names = _normalize_class_names(payload.get("class_names"))
        elif "names" in payload:
            class_names = _normalize_class_names(payload.get("names"))
        elif "classes" in payload:
            class_names = _normalize_class_names(payload.get("classes"))

    class_names = [name for name in class_names if name]
    if not class_names:
        raise HTTPException(
            status_code=400,
            detail=(
                'Could not find class names in classes.json. Expected '
                '{"class_names": [...]}, {"names": [...]}, or a JSON array.'
            ),
        )
    return class_names


def _extract_ultralytics_model_info(model_path: Path) -> Dict[str, Any]:
    """Extract class names and image size from Ultralytics YOLO model."""
    try:
        from app.tasks.training_common import get_ultralytics_yolo
        YOLO = get_ultralytics_yolo()

        model = YOLO(str(model_path))
        class_names = _normalize_class_names(getattr(model, "names", []))
        
        # Extract image size from model args
        imgsz = 640  # default fallback
        if hasattr(model, "args") and model.args:
            # model.args.imgsz could be int or list/tuple [h, w]
            model_imgsz = getattr(model.args, "imgsz", 640)
            if isinstance(model_imgsz, (list, tuple)) and len(model_imgsz) > 0:
                imgsz = int(model_imgsz[0])
            elif isinstance(model_imgsz, int):
                imgsz = model_imgsz
        
        return {
            "class_names": class_names,
            "image_size": imgsz,
        }
    except Exception as exc:
        logger.warning("Failed to extract model info from %s: %s", model_path, exc)
        return {
            "class_names": [],
            "image_size": 640,
        }


def _extract_ultralytics_class_names(model_path: Path) -> List[str]:
    """Backward compatibility wrapper - extract only class names from YOLO model."""
    info = _extract_ultralytics_model_info(model_path)
    return info.get("class_names", [])


def _sanitize_uploaded_filename(filename: Optional[str], expected_suffix: str) -> str:
    candidate = Path(filename or f"imported_model{expected_suffix}").name
    candidate = re.sub(r'[^A-Za-z0-9._-]', '_', candidate).strip('._')
    if not candidate:
        candidate = f"imported_model{expected_suffix}"
    if Path(candidate).suffix.lower() != expected_suffix:
        candidate = f"{Path(candidate).stem}{expected_suffix}"
    return candidate


@router.post("/training/import")
async def import_model(
    name: str = Form(...),
    project_id: int = Form(...),
    model_format: str = Form(...),
    model_file: Optional[UploadFile] = File(None),
    pt: Optional[UploadFile] = File(None),
    onnx: Optional[UploadFile] = File(None),
    classes: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    model_name = name.strip()
    if not model_name:
        raise HTTPException(status_code=400, detail="Model name is required")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    fmt = model_format.strip().lower()
    if fmt not in {"pt", "onnx"}:
        raise HTTPException(status_code=400, detail="model_format must be 'pt' or 'onnx'")

    upload = model_file or (pt if fmt == "pt" else onnx)
    if not upload:
        raise HTTPException(status_code=400, detail="Model file is required")

    expected_suffix = f".{fmt}"
    original_filename = upload.filename or f"imported_model{expected_suffix}"
    if Path(original_filename).suffix.lower() != expected_suffix:
        raise HTTPException(status_code=400, detail=f"Expected a {expected_suffix} file")

    task = Task(
        name=model_name,
        description=f"Imported {fmt.upper()} model",
        task_type="training",
        status="pending",
        project_id=project_id,
        progress=0,
        started_at=datetime.utcnow(),
        task_metadata={"stage": "importing_model", "model_format": fmt},
    )
    db.add(task)
    db.flush()

    task_root = Path("projects") / str(project_id) / "training" / f"task_{task.id}"
    results_dir = task_root / "training"
    weights_dir = results_dir / "weights"
    imports_dir = task_root / "imports"
    weights_dir.mkdir(parents=True, exist_ok=True)
    imports_dir.mkdir(parents=True, exist_ok=True)

    model_filename = _sanitize_uploaded_filename(original_filename, expected_suffix)
    model_path = (weights_dir / model_filename) if fmt == "pt" else (imports_dir / model_filename)

    try:
        with model_path.open("wb") as target:
            shutil.copyfileobj(upload.file, target)

        class_names = await _read_import_classes(classes)
        image_size = 640  # default
        
        if fmt == "onnx":
            if not class_names:
                raise HTTPException(status_code=400, detail="classes.json is required for ONNX model imports")
            classes_path = Path(str(model_path) + ".classes.json")
            with classes_path.open("w", encoding="utf-8") as classes_file:
                json.dump({"class_names": class_names}, classes_file, indent=2)
            # Try to extract image size from ONNX model input shape
            try:
                import onnx
                onnx_model = onnx.load(str(model_path))
                if onnx_model.graph.input:
                    input_tensor = onnx_model.graph.input[0]
                    if input_tensor.type.tensor_type.shape.dim:
                        # ONNX typically has shape [batch, channels, height, width] or [batch, height, width, channels]
                        dims = [d.dim_value for d in input_tensor.type.tensor_type.shape.dim if d.dim_value > 0]
                        if len(dims) >= 3:
                            # Try to find the image dimension (usually the largest non-batch dimension)
                            spatial_dims = dims[1:]  # Skip batch dimension
                            image_size = int(spatial_dims[0]) if spatial_dims else 640
            except Exception as e:
                logger.debug("Could not extract image size from ONNX model: %s", e)
                image_size = 640
        else:  # fmt == "pt"
            if not class_names:
                model_info = _extract_ultralytics_model_info(model_path)
                class_names = model_info.get("class_names", [])
                image_size = model_info.get("image_size", 640)
            else:
                # If class names were provided but we still need image size, extract just that
                model_info = _extract_ultralytics_model_info(model_path)
                image_size = model_info.get("image_size", 640)

        metadata: Dict[str, Any] = {
            "source": "imported_model",
            "imported_model": True,
            "imported_at": datetime.utcnow().isoformat(),
            "model_format": fmt,
            "model_type": model_filename,
            "model_config": {"model": model_filename},
            "results_dir": str(results_dir),
            "class_names": class_names,
            "num_classes": len(class_names),
            "image_size": image_size,
            "original_model_file": original_filename,
        }
        if fmt == "pt":
            metadata["best_model"] = str(model_path)
        else:
            metadata["onnx_file"] = str(model_path)

        task.status = "completed"
        task.progress = 100
        task.completed_at = datetime.utcnow()
        task.task_metadata = metadata

        db.commit()
        db.refresh(task)

        return {
            "success": True,
            "message": "Model imported successfully",
            "task": {
                "id": task.id,
                "name": task.name,
                "status": task.status,
                "task_type": task.task_type,
                "task_metadata": task.task_metadata,
            },
        }
    except HTTPException:
        db.rollback()
        shutil.rmtree(task_root, ignore_errors=True)
        raise
    except Exception as exc:
        db.rollback()
        shutil.rmtree(task_root, ignore_errors=True)
        logger.exception("Failed to import model for project %s", project_id)
        raise HTTPException(status_code=500, detail=f"Failed to import model: {exc}") from exc


def prepare_yolo_dataset(
    db: Session,
    dataset_configs: List[Dict[str, Any]],
    output_dir: Path,
    model_type: str = "yolo11n-seg.pt",
    remove_images_without_annotations: bool = True
) -> Dict[str, Any]:
    """
    Prepare YOLO format dataset from database annotations.
    
    Args:
        db: Database session
        dataset_configs: List of dataset configurations
        output_dir: Output directory for the dataset
        model_type: YOLO model type (e.g., 'yolo11n-seg.pt' for segmentation)
    
    Returns:
        Dict with paths and class names
    """
    # Determine if this is a segmentation model
    is_segmentation_model = '-seg' in model_type.lower()
    
    # Track skipped annotations
    skipped_annotations = {'missing_seg': 0, 'missing_bbox': 0, 'missing_both': 0}
    
    # Statistics tracking
    stats = {
        'total_images': {"train": 0, "val": 0, "test": 0},
        'total_annotations': {"train": 0, "val": 0, "test": 0},
        'annotations_per_class': {},  # Will be filled during processing
        'images_filtered': 0,  # Images removed due to no valid annotations
        'images_processed': 0,
    }
    
    # Create directory structure
    train_images_dir = output_dir / "images" / "train"
    val_images_dir = output_dir / "images" / "val"
    test_images_dir = output_dir / "images" / "test"
    train_labels_dir = output_dir / "labels" / "train"
    val_labels_dir = output_dir / "labels" / "val"
    test_labels_dir = output_dir / "labels" / "test"
    
    for directory in [train_images_dir, val_images_dir, test_images_dir, 
                     train_labels_dir, val_labels_dir, test_labels_dir]:
        directory.mkdir(parents=True, exist_ok=True)
    
    # Collect all classes across all datasets
    all_classes = set()
    class_mapping = {}
    
    # Track annotation types for validation
    has_segmentation = False
    has_bbox_only = False
    
    # First pass: collect all unique classes
    for config in dataset_configs:
        dataset_id = config['dataset_id']
        annotation_file_id = config['annotation_file_id']
        
        logger.info(f"Looking for annotation classes - dataset_id: {dataset_id}, annotation_file_id: {annotation_file_id}")
        
        # Get annotation classes
        annotation_classes = db.query(AnnotationClass).filter(
            AnnotationClass.annotation_file_id == annotation_file_id
        ).all()
        
        logger.info(f"Found {len(annotation_classes)} annotation classes for annotation_file_id: {annotation_file_id}")
        
        if not annotation_classes:
            # Try to find the annotation file first
            annotation_file = db.query(AnnotationFile).filter(
                AnnotationFile.dataset_id == dataset_id
            ).first()
            
            if annotation_file:
                logger.info(f"Found annotation file with id: {annotation_file.id}, name: {annotation_file.name}")
                # Retry with the correct ID
                annotation_classes = db.query(AnnotationClass).filter(
                    AnnotationClass.annotation_file_id == annotation_file.id
                ).all()
                logger.info(f"Found {len(annotation_classes)} annotation classes using annotation_file.id")
        
        for ann_class in annotation_classes:
            all_classes.add(ann_class.class_name)
            logger.info(f"Added class: {ann_class.class_name}")
    
    logger.info(f"Total unique classes found: {len(all_classes)} - {sorted(list(all_classes))}")
    
    # Create class mapping (sorted for consistency)
    sorted_classes = sorted(list(all_classes))
    class_mapping = {class_name: idx for idx, class_name in enumerate(sorted_classes)}
    
    # Process each dataset configuration
    total_images = {"train": 0, "val": 0, "test": 0}
    
    for config in dataset_configs:
        dataset_id = config['dataset_id']
        annotation_file_id = config['annotation_file_id']
        image_collection = config.get('image_collection')
        split = config.get('split', {'train': 80, 'val': 20, 'test': 0})
        
        # Get dataset and images
        dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            logger.warning(f"Dataset {dataset_id} not found, skipping")
            continue
        
        # Query images, optionally filter by collection
        images_query = db.query(Image).filter(Image.dataset_id == dataset_id)
        if image_collection:
            # Filter by collection name through the relationship
            images_query = images_query.join(Image.collection).filter(
                ImageCollection.name == image_collection
            )
        
        images = images_query.all()
        
        if not images:
            logger.warning(f"No images found for dataset {dataset_id}, skipping")
            continue
        
        # Filter out images without VALID annotations BEFORE splitting (if flag is set)
        if remove_images_without_annotations:
            images_with_annotations = []
            for img in images:
                # Get annotations for this image
                annotations = db.query(Annotation).filter(
                    Annotation.image_id == img.id,
                    Annotation.annotation_file_id == annotation_file_id
                ).all()
                
                # Check if ANY annotation meets the requirements
                has_valid_annotation = False
                for annotation in annotations:
                    # For segmentation models, annotation must have BOTH segmentation and bbox
                    if is_segmentation_model:
                        has_seg = annotation.segmentation and len(annotation.segmentation) > 0
                        has_bbox = (annotation.bbox or 
                                   (annotation.bbox_x is not None and annotation.bbox_width is not None))
                        if has_seg and has_bbox:
                            has_valid_annotation = True
                            break
                    else:
                        # For detection models, just need bbox
                        has_bbox = (annotation.bbox or 
                                   (annotation.bbox_x is not None and annotation.bbox_width is not None))
                        if has_bbox:
                            has_valid_annotation = True
                            break
                
                if has_valid_annotation:
                    images_with_annotations.append(img)
            
            images_before = len(images)
            images = images_with_annotations
            images_after = len(images)
            
            filtered_count = images_before - images_after
            stats['images_filtered'] += filtered_count
            if images_before != images_after:
                logger.info(f"Filtered dataset {dataset_id}: {images_before} → {images_after} images (removed {filtered_count} without valid annotations)")
            
            if not images:
                logger.warning(f"No images with annotations found for dataset {dataset_id} after filtering, skipping")
                continue
        
        # Calculate split indices
        total_count = len(images)
        train_count = int(total_count * split['train'] / 100)
        val_count = int(total_count * split['val'] / 100)
        # test gets the remainder
        
        # Split images
        train_images = images[:train_count]
        val_images = images[train_count:train_count + val_count]
        test_images = images[train_count + val_count:]
        
        # Process each split
        for split_name, split_images, img_dir, lbl_dir in [
            ('train', train_images, train_images_dir, train_labels_dir),
            ('val', val_images, val_images_dir, val_labels_dir),
            ('test', test_images, test_images_dir, test_labels_dir)
        ]:
            for image in split_images:
                # Construct image file path from URL or file_name
                # Images are stored in projects/{dataset_id}/ directory
                if image.url:
                    # URL format: /static/projects/{dataset_id}/{filename}
                    # or could be absolute path
                    if image.url.startswith('/static/projects/'):
                        # Convert URL to file path
                        src_image_path = Path('projects') / image.url.replace('/static/projects/', '')
                    elif image.url.startswith('projects/'):
                        src_image_path = Path(image.url)
                    else:
                        # Assume it's just the dataset_id/filename
                        src_image_path = Path('projects') / str(dataset_id) / image.file_name
                else:
                    # Fallback to constructing from dataset_id and file_name
                    src_image_path = Path('projects') / str(dataset_id) / image.file_name
                
                if not src_image_path.exists():
                    logger.warning(f"Image file not found: {src_image_path}")
                    continue
                
                # Generate safe filename with dataset_id to prevent collisions
                safe_filename = generate_safe_output_filename(src_image_path.name, image.dataset_id)
                safe_stem = Path(safe_filename).stem
                dst_image_path = img_dir / safe_filename
                
                # Create hard link or copy
                try:
                    if not dst_image_path.exists():
                        os.link(src_image_path, dst_image_path)
                except:
                    shutil.copy2(src_image_path, dst_image_path)
                
                # Get annotations for this image
                annotations = db.query(Annotation).filter(
                    Annotation.image_id == image.id,
                    Annotation.annotation_file_id == annotation_file_id
                ).all()
                
                # At this point, images without annotations have already been filtered out
                # during the pre-split filtering step if remove_images_without_annotations is True
                if not annotations:
                    if remove_images_without_annotations:
                        # This shouldn't happen since we filtered before splitting
                        logger.warning(f"Image {image.id} has no annotations but wasn't filtered - this is unexpected")
                        continue
                    else:
                        # Create empty label file for images without annotations
                        label_path = lbl_dir / f"{safe_stem}.txt"
                        label_path.touch()
                        total_images[split_name] += 1
                        continue
                
                # Create YOLO format label file
                label_lines = []
                for annotation in annotations:
                    # Get class ID from mapping
                    ann_class = db.query(AnnotationClass).filter(
                        AnnotationClass.annotation_file_id == annotation_file_id,
                        AnnotationClass.category_id == annotation.category_id
                    ).first()
                    
                    if not ann_class:
                        continue
                    
                    class_id = class_mapping.get(ann_class.class_name)
                    if class_id is None:
                        continue
                    
                    # For segmentation models, skip annotations without both segmentation and bbox
                    if is_segmentation_model:
                        has_seg = annotation.segmentation and len(annotation.segmentation) > 0
                        has_bbox = (annotation.bbox or 
                                   (annotation.bbox_x is not None and annotation.bbox_width is not None))
                        
                        if not (has_seg and has_bbox):
                            # Track which type of data is missing
                            if not has_seg and not has_bbox:
                                skipped_annotations['missing_both'] += 1
                            elif not has_seg:
                                skipped_annotations['missing_seg'] += 1
                            else:
                                skipped_annotations['missing_bbox'] += 1
                            logger.debug(f"Skipping annotation {annotation.id} - missing seg or bbox (has_seg={has_seg}, has_bbox={has_bbox})")
                            continue
                    
                    # Get image dimensions. Fall back to reading the real image size
                    # if DB metadata is missing, otherwise normalized labels become invalid.
                    img_width = image.width
                    img_height = image.height
                    if not img_width or not img_height or img_width <= 0 or img_height <= 0:
                        try:
                            from PIL import Image as PILImage
                            with PILImage.open(dst_image_path) as pil_img:
                                img_width, img_height = pil_img.size
                        except Exception as dim_err:
                            logger.warning(
                                f"Could not read image dimensions for {dst_image_path}: {dim_err}; using 1x1 fallback"
                            )
                            img_width, img_height = 1, 1
                    
                    # Handle segmentation if present
                    if annotation.segmentation:
                        seg = annotation.segmentation
                        if isinstance(seg, list) and len(seg) > 0:
                            # Polygon format: [[x1, y1, x2, y2, ...]] or [x1, y1, x2, y2, ...]
                            if isinstance(seg[0], list):
                                polygon = seg[0]
                            else:
                                polygon = seg
                            
                            # Only process if polygon has valid data
                            if len(polygon) >= 6:  # At least 3 points (6 coordinates)
                                # Check if coordinates are already normalized (0-1) or in pixel coordinates
                                # If any value is > 2, assume pixel coordinates that need normalization
                                needs_normalization = any(abs(val) > 2 for val in polygon)
                                
                                normalized_coords = []
                                if needs_normalization:
                                    # Pixel coordinates - normalize them
                                    for i in range(0, len(polygon), 2):
                                        if i + 1 < len(polygon):
                                            norm_x = polygon[i] / img_width
                                            norm_y = polygon[i + 1] / img_height
                                            normalized_coords.extend([norm_x, norm_y])
                                else:
                                    # Already normalized - use as is
                                    normalized_coords = polygon
                                
                                # YOLO segmentation format: class_id x1 y1 x2 y2 ...
                                if normalized_coords and len(normalized_coords) >= 6:
                                    coords_str = ' '.join(f"{c:.6f}" for c in normalized_coords)
                                    label_lines.append(f"{class_id} {coords_str}")
                                    # Track annotation stats
                                    class_name = ann_class.class_name
                                    if class_name not in stats['annotations_per_class']:
                                        stats['annotations_per_class'][class_name] = {"train": 0, "val": 0, "test": 0}
                                    stats['annotations_per_class'][class_name][split_name] += 1
                                    stats['total_annotations'][split_name] += 1
                                    has_segmentation = True
                                    continue  # Skip bbox processing for this annotation
                    
                    # Handle bbox (COCO format: [x, y, width, height])
                    elif annotation.bbox:
                        has_bbox_only = True
                        bbox = annotation.bbox
                        if isinstance(bbox, list) and len(bbox) == 4:
                            x, y, w, h = bbox
                        elif isinstance(bbox, dict):
                            x = bbox.get('x', 0)
                            y = bbox.get('y', 0)
                            w = bbox.get('width', 0)
                            h = bbox.get('height', 0)
                        else:
                            # Try individual fields
                            x = annotation.bbox_x or 0
                            y = annotation.bbox_y or 0
                            w = annotation.bbox_width or 0
                            h = annotation.bbox_height or 0
                        
                        # Convert to YOLO format (normalized center x, center y, width, height)
                        x_center = (x + w / 2) / img_width
                        y_center = (y + h / 2) / img_height
                        norm_w = w / img_width
                        norm_h = h / img_height
                        
                        # YOLO detection format
                        label_lines.append(f"{class_id} {x_center:.6f} {y_center:.6f} {norm_w:.6f} {norm_h:.6f}")
                        # Track annotation stats
                        class_name = ann_class.class_name
                        if class_name not in stats['annotations_per_class']:
                            stats['annotations_per_class'][class_name] = {"train": 0, "val": 0, "test": 0}
                        stats['annotations_per_class'][class_name][split_name] += 1
                        stats['total_annotations'][split_name] += 1
                    
                    # Try individual bbox fields if bbox JSON is not present
                    elif annotation.bbox_x is not None and annotation.bbox_width is not None:
                        x = annotation.bbox_x
                        y = annotation.bbox_y or 0
                        w = annotation.bbox_width
                        h = annotation.bbox_height or 0
                        
                        # Convert to YOLO format (normalized center x, center y, width, height)
                        x_center = (x + w / 2) / img_width
                        y_center = (y + h / 2) / img_height
                        norm_w = w / img_width
                        norm_h = h / img_height
                        
                        # YOLO detection format
                        label_lines.append(f"{class_id} {x_center:.6f} {y_center:.6f} {norm_w:.6f} {norm_h:.6f}")
                        # Track annotation stats
                        class_name = ann_class.class_name
                        if class_name not in stats['annotations_per_class']:
                            stats['annotations_per_class'][class_name] = {"train": 0, "val": 0, "test": 0}
                        stats['annotations_per_class'][class_name][split_name] += 1
                        stats['total_annotations'][split_name] += 1
                
                # Write label file (create empty file if no annotations but image is kept)
                if label_lines:
                    label_path = lbl_dir / f"{safe_stem}.txt"
                    with open(label_path, 'w') as f:
                        f.write('\n'.join(label_lines))
                    # Track image was processed
                    stats['total_images'][split_name] += 1
                    stats['images_processed'] += 1
                elif not remove_images_without_annotations:
                    # Create empty label file if we're keeping images without annotations
                    label_path = lbl_dir / f"{safe_stem}.txt"
                    label_path.touch()
                    # Track this image too
                    stats['total_images'][split_name] += 1
                    stats['images_processed'] += 1
                
                total_images[split_name] += 1
    
    # Log annotation type summary
    logger.info(f"Annotation summary - has_segmentation: {has_segmentation}, has_bbox_only: {has_bbox_only}")
    logger.info(f"Model type: {model_type}, is_segmentation_model: {is_segmentation_model}")
    
    # Log skipped annotations
    total_skipped = sum(skipped_annotations.values())
    if total_skipped > 0:
        logger.warning(f"⚠️ Skipped {total_skipped} annotations during dataset preparation:")
        if skipped_annotations['missing_seg'] > 0:
            logger.warning(f"  - {skipped_annotations['missing_seg']} annotations missing segmentation data")
        if skipped_annotations['missing_bbox'] > 0:
            logger.warning(f"  - {skipped_annotations['missing_bbox']} annotations missing bounding box data")
        if skipped_annotations['missing_both'] > 0:
            logger.warning(f"  - {skipped_annotations['missing_both']} annotations missing both segmentation and bbox data")
        logger.warning(f"  Reason: Segmentation models require both polygon and bounding box data for each annotation.")
    
    # Validate annotation format matches model type
    if is_segmentation_model and not has_segmentation:
        if has_bbox_only:
            raise ValueError(
                f"ERROR ❌ Model type '{model_type}' requires segmentation annotations (polygons), "
                f"but only bounding box annotations were found.\n\n"
                f"To fix this:\n"
                f"1. Use a detection model (e.g., 'yolo11n.pt' instead of 'yolo11n-seg.pt'), OR\n"
                f"2. Create segmentation annotations (polygons) for your dataset instead of bounding boxes.\n\n"
                f"See https://docs.ultralytics.com/datasets/segment/ for segmentation dataset format."
            )
        else:
            raise ValueError(
                f"ERROR ❌ No valid annotations found for training.\n"
                f"Model type '{model_type}' requires segmentation annotations (polygons).\n\n"
                f"Please check:\n"
                f"1. Your dataset has annotations uploaded\n"
                f"2. The annotations contain segmentation data (polygons)\n"
                f"3. The annotation file is properly linked to images"
            )
    elif not is_segmentation_model and has_segmentation and not has_bbox_only:
        logger.warning(
            f"Model type '{model_type}' is a detection model, but segmentation annotations were found. "
            f"Consider using a segmentation model (e.g., 'yolo11n-seg.pt') to utilize polygon annotations."
        )
    
    # Create data.yaml file for YOLO
    if not class_mapping:
        raise ValueError("No annotation classes found. Make sure your datasets have annotations with classes defined.")
    
    if total_images['train'] == 0 and total_images['val'] == 0:
        raise ValueError("No images were processed. Check that your datasets have images with annotations.")
    
    # Get absolute path - ensure it starts with /app in Docker context
    abs_path = output_dir.absolute()
    if not str(abs_path).startswith('/app/'):
        # If path is relative or doesn't start with /app, prepend /app
        abs_path = Path('/app') / output_dir
    
    yaml_content = {
        'path': str(abs_path),
        'train': 'images/train',
        'val': 'images/val',
        'test': 'images/test' if total_images['test'] > 0 else None,
        'names': {idx: name for name, idx in class_mapping.items()},
        'nc': len(class_mapping)
    }
    
    logger.info(f"Dataset summary: {total_images['train']} train, {total_images['val']} val, {total_images['test']} test images")
    logger.info(f"Classes: {class_mapping}")
    
    yaml_path = output_dir / "data.yaml"
    with open(yaml_path, 'w') as f:
        # Write YAML manually for better control
        f.write(f"path: {yaml_content['path']}\n")
        f.write(f"train: {yaml_content['train']}\n")
        f.write(f"val: {yaml_content['val']}\n")
        if yaml_content['test']:
            f.write(f"test: {yaml_content['test']}\n")
        # Add task type for segmentation models
        if is_segmentation_model:
            f.write("task: segment\n")
        f.write(f"nc: {yaml_content['nc']}\n")
        f.write("names:\n")
        for idx, name in yaml_content['names'].items():
            f.write(f"  {idx}: {name}\n")
    
    return {
        'yaml_path': str(yaml_path),
        'class_names': sorted_classes,
        'class_count': len(sorted_classes),
        'image_counts': total_images,
        'dataset_stats': stats  # Include comprehensive statistics
    }


async def train_yolo_model_task(
    task_id: int,
    training_config: Dict[str, Any]
):
    """Background task to train YOLO model with progress updates"""
    logger.info(f"Starting YOLO training task {task_id}")
    db = SessionLocal()
    
    # Custom callback for progress updates
    class ProgressCallback:
        def __init__(self, task_id: int, total_epochs: int):
            self.task_id = task_id
            self.total_epochs = total_epochs
            self.current_epoch = 0
            
        def on_train_epoch_end(self, trainer):
            """Called at the end of each training epoch"""
            self.current_epoch = trainer.epoch + 1
            # Progress: 40% (loading) + 50% (training) + 10% (saving)
            progress = 40 + int((self.current_epoch / self.total_epochs) * 50)
            
            # Update task in database
            db_local = SessionLocal()
            try:
                task = db_local.query(Task).filter(Task.id == self.task_id).first()
                if task:
                    task.progress = min(progress, 90)
                    task.task_metadata = {
                        **(task.task_metadata or {}),
                        "current_epoch": self.current_epoch,
                        "total_epochs": self.total_epochs,
                        "stage": "training"
                    }
                    db_local.commit()
                    logger.info(f"Task {self.task_id}: Epoch {self.current_epoch}/{self.total_epochs} - Progress: {progress}%")
            except Exception as e:
                logger.error(f"Failed to update progress: {e}")
            finally:
                db_local.close()
    
    try:
        # Update task status
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            logger.error(f"Task {task_id} not found")
            return
        
        task.status = "running"
        task.started_at = datetime.utcnow()
        db.commit()
        
        # Prepare dataset
        logger.info(f"Preparing dataset for task {task_id}")
        task.progress = 10
        task.task_metadata = {"stage": "preparing_dataset"}
        db.commit()
        
        # Create output directory
        output_base = Path("projects") / str(training_config['project_id']) / "training" / f"task_{task_id}"
        output_base.mkdir(parents=True, exist_ok=True)
        
        dataset_dir = output_base / "dataset"
        model_type = training_config.get('model_type', 'yolo11n-seg.pt')
        dataset_info = prepare_yolo_dataset(
            db,
            training_config['dataset_configs'],
            dataset_dir,
            model_type=model_type,
            remove_images_without_annotations=training_config.get('remove_images_without_annotations', True)
        )
        
        logger.info(f"Dataset prepared: {dataset_info}")
        task.progress = 30
        task.task_metadata = {
            "stage": "dataset_prepared",
            "dataset_info": dataset_info
        }
        db.commit()
        
        # Import ultralytics and train
        try:
            from app.tasks.training_common import get_ultralytics_yolo
            YOLO = get_ultralytics_yolo()
        except ImportError as _e:
            raise Exception(f"ultralytics YOLO could not be imported: {_e}")
        
        # Initialize model
        model_type = training_config.get('model_type', 'yolo11n-seg.pt')
        logger.info(f"Loading YOLO model: {model_type}")
        
        # Check if model file exists in project root, otherwise use pretrained
        model_path = Path(model_type)
        if not model_path.exists():
            # Use model name directly, ultralytics will download if needed
            model_path = model_type
        
        model = YOLO(str(model_path))
        
        # Add progress callback
        total_epochs = training_config.get('epochs', 100)
        progress_callback = ProgressCallback(task_id, total_epochs)
        
        # Add callback to model
        model.add_callback("on_train_epoch_end", progress_callback.on_train_epoch_end)
        
        task.progress = 40
        task.task_metadata = {
            **task.task_metadata,
            "stage": "training",
            "model_loaded": str(model_path),
            "total_epochs": total_epochs
        }
        db.commit()
        
        # Set up training arguments
        train_args = {
            'data': dataset_info['yaml_path'],
            'epochs': total_epochs,
            'batch': training_config.get('batch_size', 16),
            'imgsz': training_config.get('image_size', 640),
            'device': training_config.get('device', '0'),
            'patience': training_config.get('patience', 50),
            'optimizer': training_config.get('optimizer', 'auto'),
            'lr0': training_config.get('learning_rate', 0.01),
            'momentum': training_config.get('momentum', 0.937),
            'weight_decay': training_config.get('weight_decay', 0.0005),
            'project': str(output_base),
            'name': 'training',
            'exist_ok': True,
            'save': True,
            'save_period': 10,  # Save checkpoint every 10 epochs
            'verbose': True,
        }
        
        # Add W&B if enabled
        if training_config.get('use_wandb'):
            train_args['project'] = training_config.get('wandb_project', f"yolo_training_{task_id}")
            if training_config.get('wandb_entity'):
                train_args['entity'] = training_config['wandb_entity']
        
        logger.info(f"Starting training with args: {train_args}")

        from app.tasks.yolo_training_helpers import prepare_yolo_training_weights_dir

        logger.info(f"Pre-train weights-dir prepare START: {output_base}")
        prepare_yolo_training_weights_dir(output_base)
        logger.info("Pre-train weights-dir prepare DONE")

        # Train the model
        results = model.train(**train_args)
        
        task.progress = 90
        task.task_metadata = {
            **task.task_metadata,
            "stage": "training_completed",
            "results_saved": str(output_base / "training")
        }
        db.commit()
        
        # Save final model and results info
        best_model_path = output_base / "training" / "weights" / "best.pt"
        last_model_path = output_base / "training" / "weights" / "last.pt"
        
        task.status = "completed"
        task.completed_at = datetime.utcnow()
        task.progress = 100
        task.task_metadata = {
            **task.task_metadata,
            "stage": "completed",
            "best_model": f"/app/{best_model_path}" if best_model_path.exists() else None,
            "last_model": f"/app/{last_model_path}" if last_model_path.exists() else None,
            "class_names": dataset_info['class_names'],
            "class_count": dataset_info['class_count'],
            "image_counts": dataset_info['image_counts'],
            "results_dir": f"/app/{output_base / 'training'}"
        }
        db.commit()
        
        logger.info(f"Training completed successfully for task {task_id}")
        
    except Exception as e:
        logger.error(f"Error in training task {task_id}: {str(e)}", exc_info=True)
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            task.status = "failed"
            task.completed_at = datetime.utcnow()
            task.error_message = str(e)
            task.task_metadata = {
                **(task.task_metadata or {}),
                "stage": "failed",
                "error": str(e)
            }
            db.commit()
    finally:
        db.close()


@router.post("/training/yolo/start")
async def start_yolo_training(
    request: YoloTrainingRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Start YOLO model training using Celery task queue.
    """
    try:
        # Validate datasets exist
        for config in request.dataset_configs:
            dataset = db.query(Dataset).filter(Dataset.id == config['dataset_id']).first()
            if not dataset:
                raise HTTPException(status_code=404, detail=f"Dataset {config['dataset_id']} not found")
            
            ann_file = db.query(AnnotationFile).filter(
                AnnotationFile.id == config['annotation_file_id']
            ).first()
            if not ann_file:
                raise HTTPException(
                    status_code=404,
                    detail=f"Annotation file {config['annotation_file_id']} not found"
                )
        
        # Create task
        task_name = request.task_name or f"YOLO Training - {request.model_type}"
        
        # Prepare dataset configs with names for metadata
        dataset_configs_with_names = []
        for config in request.dataset_configs:
            dataset = db.query(Dataset).filter(Dataset.id == config['dataset_id']).first()
            ann_file = db.query(AnnotationFile).filter(
                AnnotationFile.id == config['annotation_file_id']
            ).first()
            
            dataset_configs_with_names.append({
                'dataset_id': config['dataset_id'],
                'dataset_name': dataset.name if dataset else None,
                'annotation_file_id': config['annotation_file_id'],
                'annotation_file_name': ann_file.name if ann_file else None,
                'image_collection': config.get('image_collection'),
                'split': config.get('split', {'train': 80, 'val': 20, 'test': 0})
            })
        
        task = Task(
            name=task_name,
            description=f"Training YOLO model with {len(request.dataset_configs)} dataset(s)",
            task_type="yolo_training",
            status="pending",
            project_id=request.project_id,
            progress=0,
            task_metadata={
                "model_type": request.model_type,
                "epochs": request.epochs,
                "batch_size": request.batch_size,
                "image_size": request.image_size,
                "dataset_count": len(request.dataset_configs),
                "dataset_ids": [config['dataset_id'] for config in request.dataset_configs],
                "dataset_configs": dataset_configs_with_names,
                "training_params": {
                    "batch_size": request.batch_size,
                    "epochs": request.epochs,
                    "image_size": request.image_size,
                    "imgsz": request.image_size,
                    "device": request.device,
                    "optimizer": request.optimizer,
                    "lr0": request.learning_rate,
                    "momentum": request.momentum,
                    "weight_decay": request.weight_decay,
                    "save_period": request.save_period,
                    "patience": request.patience
                },
                "model_config": {
                    "model": request.model_type,
                    "task": "detect",
                    "augmentations": request.augmentations or {}
                },
                "remove_images_without_annotations": request.remove_images_without_annotations
            }
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        
        # Prepare training config
        training_config = {
            'project_id': request.project_id,
            'dataset_configs': request.dataset_configs,
            'model_type': request.model_type,
            'epochs': request.epochs,
            'batch_size': request.batch_size,
            'image_size': request.image_size,
            'device': request.device,
            'patience': request.patience,
            'optimizer': request.optimizer,
            'learning_rate': request.learning_rate,
            'momentum': request.momentum,
            'weight_decay': request.weight_decay,
            'save_period': request.save_period,
            'augmentations': request.augmentations or {},
            'remove_images_without_annotations': request.remove_images_without_annotations,
            'use_wandb': request.use_wandb,
            'wandb_project': request.wandb_project,
            'wandb_entity': request.wandb_entity,
        }
        
        logger.info(f"Prepared training config for task {task.id}: keys={list(training_config.keys())}")
        logger.info(f"Training config: model_type={training_config['model_type']}, epochs={training_config['epochs']}, remove_images={training_config.get('remove_images_without_annotations')}")
        
        # Start background task
        if USE_CELERY:
            # Use Celery for proper task queuing
            logger.info(f"Queuing Celery task for training task {task.id}")
            celery_task = celery_train_task.delay(task.id, training_config)
            logger.info(f"Queued training task {task.id} in Celery (task_id: {celery_task.id})")
            
            # Store Celery task ID in metadata
            task.task_metadata = {
                **task.task_metadata,
                "celery_task_id": celery_task.id
            }
            db.commit()
        else:
            # Fallback to FastAPI BackgroundTasks (not recommended for production)
            logger.warning("Using BackgroundTasks instead of Celery - tasks may run concurrently!")
            background_tasks.add_task(
                train_yolo_model_task,
                task.id,
                training_config
            )

        tw_cached = is_training_base_weights_cached(request.model_type)

        return {
            "success": True,
            "task_id": task.id,
            "message": "YOLO training started",
            "weights_download_expected": not tw_cached,
            "weights_download_notice": None if tw_cached else WEIGHTS_DOWNLOAD_NOTICE,
            "task": {
                "id": task.id,
                "name": task.name,
                "status": task.status,
                "progress": task.progress
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting YOLO training: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/training/{task_id}/rerun")
async def rerun_training(
    task_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Rerun a training task with the same settings.
    Creates a new task with identical configuration and starts training.
    """
    try:
        # Get the original task
        original_task = db.query(Task).filter(Task.id == task_id).first()
        if not original_task:
            raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
        
        if original_task.task_type not in ['yolo_training', 'training', 'mmyolo_training']:
            raise HTTPException(
                status_code=400,
                detail=f"Task type {original_task.task_type} is not supported for rerun"
            )
        
        # Extract configuration from task metadata
        metadata = original_task.task_metadata or {}
        training_params = metadata.get('training_params', {})
        dataset_configs = metadata.get('dataset_configs', [])
        
        # Log full metadata structure for debugging
        logger.info(f"Rerun task {task_id}: Full metadata keys = {list(metadata.keys())}")
        logger.info(f"Rerun task {task_id}: dataset_configs type = {type(dataset_configs)}, count = {len(dataset_configs) if dataset_configs else 0}")
        logger.info(f"Rerun task {task_id}: dataset_ids = {metadata.get('dataset_ids', [])}")
        if dataset_configs:
            logger.info(f"Rerun task {task_id}: First dataset_config sample = {dataset_configs[0] if len(dataset_configs) > 0 else 'N/A'}")
        
        # Reconstruct dataset_configs (remove names, keep only IDs and config)
        reconstructed_configs = []
        
        # First, try to use dataset_configs from metadata
        if dataset_configs and isinstance(dataset_configs, list) and len(dataset_configs) > 0:
            logger.info(f"Processing {len(dataset_configs)} dataset configs from metadata")
            for idx, config in enumerate(dataset_configs):
                if not isinstance(config, dict):
                    logger.warning(f"Dataset config {idx} is not a dict: {type(config)}")
                    continue
                    
                dataset_id = config.get('dataset_id')
                annotation_file_id = config.get('annotation_file_id')
                
                # Validate required fields - handle both int and string types
                if not dataset_id or annotation_file_id is None:
                    logger.warning(f"Dataset config {idx} missing required fields: dataset_id={dataset_id}, annotation_file_id={annotation_file_id}")
                    continue
                
                # Convert annotation_file_id to int if it's a string
                try:
                    annotation_file_id = int(annotation_file_id) if isinstance(annotation_file_id, str) else annotation_file_id
                    dataset_id = int(dataset_id) if isinstance(dataset_id, str) else dataset_id
                except (ValueError, TypeError) as e:
                    logger.warning(f"Invalid dataset_id or annotation_file_id in config {idx}: {config}, error: {e}")
                    continue
                
                reconstructed_configs.append({
                    'dataset_id': dataset_id,
                    'annotation_file_id': annotation_file_id,
                    'image_collection': config.get('image_collection'),
                    'split': config.get('split', {'train': 80, 'val': 20, 'test': 0})
                })
                logger.info(f"Reconstructed config {idx}: dataset_id={dataset_id}, annotation_file_id={annotation_file_id}")
        
        # If dataset_configs is empty or invalid, try to reconstruct from dataset_ids
        if not reconstructed_configs:
            dataset_ids = metadata.get('dataset_ids', [])
            model_type = metadata.get('model_type', '')
            is_segmentation = '-seg' in model_type.lower()
            
            if dataset_ids:
                # Try to find annotation files for these datasets
                for dataset_id in dataset_ids:
                    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
                    if not dataset:
                        continue
                    
                    # Get annotation files for this dataset
                    ann_files = db.query(AnnotationFile).filter(
                        AnnotationFile.dataset_id == dataset_id
                    ).all()
                    
                    if ann_files:
                        # Try to find an annotation file matching the model type
                        selected_ann_file = None
                        
                        for ann_file in ann_files:
                            # Check if this annotation file has segmentation data
                            has_segmentation = db.query(Annotation).filter(
                                Annotation.annotation_file_id == ann_file.id,
                                Annotation.segmentation.isnot(None)
                            ).first() is not None
                            
                            if is_segmentation and has_segmentation:
                                selected_ann_file = ann_file
                                logger.info(f"Found matching segmentation annotation file {ann_file.id} for dataset {dataset_id}")
                                break
                            elif not is_segmentation and not has_segmentation:
                                selected_ann_file = ann_file
                                logger.info(f"Found matching bbox annotation file {ann_file.id} for dataset {dataset_id}")
                                break
                        
                        # Fallback to first if no match found
                        if not selected_ann_file:
                            selected_ann_file = ann_files[0]
                            logger.warning(
                                f"No matching annotation type found, using first annotation file {selected_ann_file.id} for dataset {dataset_id}"
                            )
                        
                        reconstructed_configs.append({
                            'dataset_id': dataset_id,
                            'annotation_file_id': selected_ann_file.id,
                            'image_collection': None,
                            'split': {'train': 80, 'val': 20, 'test': 0}
                        })
                        logger.warning(
                            f"Reconstructed dataset config for task {task_id}: "
                            f"using annotation file {selected_ann_file.id} ({selected_ann_file.name}) for dataset {dataset_id}"
                        )
        
        if not reconstructed_configs:
            # Log the metadata structure for debugging
            logger.error(f"Task {task_id} metadata structure: {json.dumps(metadata, indent=2, default=str)}")
            logger.error(f"Task {task_id} task_type: {original_task.task_type}")
            logger.error(f"Task {task_id} project_id: {original_task.project_id}")
            
            # Try one more fallback: check if we can get dataset_ids from the project
            if original_task.project_id:
                # Try to find any datasets in the project and use the first annotation file
                project_datasets = db.query(Dataset).filter(Dataset.project_id == original_task.project_id).all()
                if project_datasets:
                    logger.warning(
                        f"Attempting fallback: scanning project {original_task.project_id} datasets for usable annotations"
                    )
                    for dataset in project_datasets:
                        ann_file = db.query(AnnotationFile).filter(
                            AnnotationFile.dataset_id == dataset.id
                        ).first()
                        if not ann_file:
                            logger.info(f"Fallback skip: dataset {dataset.id} has no annotation files")
                            continue

                        reconstructed_configs.append({
                            'dataset_id': dataset.id,
                            'annotation_file_id': ann_file.id,
                            'image_collection': None,
                            'split': {'train': 80, 'val': 20, 'test': 0}
                        })
                        logger.warning(
                            f"Fallback: Using dataset {dataset.id} with annotation file {ann_file.id}"
                        )
                        break
            
            if not reconstructed_configs:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Cannot rerun task {task_id}: dataset configuration not found in task metadata. "
                        f"The task may have been created with an older version of the system or the metadata was corrupted. "
                        f"Please check the task metadata or create a new training task manually. "
                        f"Metadata keys available: {list(metadata.keys())}"
                    )
                )
        
        # Determine model type/family
        model_type_raw = metadata.get('model_type') or metadata.get('model_config', {}).get('model') or 'yolo11n-seg.pt'
        model_variant = metadata.get('model_variant')
        is_mmyolo = original_task.task_type == 'mmyolo_training' or bool(metadata.get('config_id')) or bool(metadata.get('arch'))
        is_rtdetr = bool(model_variant) or str(model_type_raw).lower().startswith('rtdetr')

        # MMYOLO rerun path
        if is_mmyolo:
            arch = metadata.get('arch') or training_params.get('arch', 'rtmdet')
            size = metadata.get('size') or training_params.get('size', 's')
            mmyolo_task = metadata.get('mmyolo_task') or training_params.get('task', 'detect')

            try:
                config_id = mmyolo_config_name(arch, size)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc))

            request_data = {
                'project_id': original_task.project_id,
                'dataset_configs': reconstructed_configs,
                'arch': arch,
                'size': size,
                'task': mmyolo_task,
                'epochs': training_params.get('epochs', metadata.get('epochs', 300)),
                'batch_size': training_params.get('batch_size', 16),
                'image_size': training_params.get('image_size', training_params.get('imgsz', 640)),
                'device': training_params.get('device', '0'),
                'task_name': f"{original_task.name} (Rerun)",
                'optimizer': training_params.get('optimizer', 'AdamW'),
                'learning_rate': training_params.get('learning_rate', 0.004),
                'weight_decay': training_params.get('weight_decay', 0.05),
                'save_period': training_params.get('save_period', -1),
                'remove_images_without_annotations': metadata.get('remove_images_without_annotations', True),
                'dji_patch_path': metadata.get('dji_patch_path'),
                'use_wandb': metadata.get('use_wandb', False),
                'wandb_project': metadata.get('wandb_project'),
                'wandb_entity': metadata.get('wandb_entity'),
            }

            request = MMYOLOTrainingRequest(**request_data)

            for cfg in request.dataset_configs:
                dataset = db.query(Dataset).filter(Dataset.id == cfg['dataset_id']).first()
                if not dataset:
                    raise HTTPException(status_code=404, detail=f"Dataset {cfg['dataset_id']} not found")
                ann_file = db.query(AnnotationFile).filter(
                    AnnotationFile.id == cfg['annotation_file_id']
                ).first()
                if not ann_file:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Annotation file {cfg['annotation_file_id']} not found"
                    )

            if request.dji_patch_path:
                patch_path = Path(request.dji_patch_path)
                if not patch_path.exists() or not patch_path.is_file():
                    raise HTTPException(status_code=400, detail="Provided DJI patch file does not exist.")
                if patch_path.suffix.lower() != ".patch":
                    raise HTTPException(status_code=400, detail="DJI patch must be a .patch file.")

            task_name = (
                request.task_name
                or f"MMYOLO {request.arch.upper()} ({request.size.upper()}) — "
                   f"{datetime.utcnow().strftime('%Y-%m-%d %H:%M')}"
            )

            task = Task(
                name=task_name,
                description=(
                    f"MMYOLO training: {request.arch} · {request.size} · {request.task} "
                    f"on {len(request.dataset_configs)} dataset(s) (Rerun of task {task_id})"
                ),
                task_type="mmyolo_training",
                status="pending",
                project_id=request.project_id,
                progress=0,
                task_metadata={
                    "model_type": f"{request.arch}_{request.size}",
                    "arch": request.arch,
                    "size": request.size,
                    "mmyolo_task": request.task,
                    "config_id": config_id,
                    "epochs": request.epochs,
                    "batch_size": request.batch_size,
                    "image_size": request.image_size,
                    "dataset_count": len(request.dataset_configs),
                    "dataset_ids": [c["dataset_id"] for c in request.dataset_configs],
                    "dataset_configs": request.dataset_configs,
                    "training_params": {
                        "epochs": request.epochs,
                        "batch_size": request.batch_size,
                        "image_size": request.image_size,
                        "device": request.device,
                        "optimizer": request.optimizer,
                        "learning_rate": request.learning_rate,
                        "weight_decay": request.weight_decay,
                        "save_period": request.save_period,
                        "arch": request.arch,
                        "size": request.size,
                        "task": request.task,
                    },
                    "remove_images_without_annotations": request.remove_images_without_annotations,
                    "dji_patch_path": request.dji_patch_path,
                    "use_wandb": request.use_wandb,
                    "wandb_project": request.wandb_project,
                    "wandb_entity": request.wandb_entity,
                    "rerun_of_task_id": task_id,
                },
            )
            db.add(task)
            db.commit()
            db.refresh(task)

            training_config = {
                "project_id": request.project_id,
                "dataset_configs": request.dataset_configs,
                "arch": request.arch,
                "size": request.size,
                "task": request.task,
                "config_id": config_id,
                "epochs": request.epochs,
                "batch_size": request.batch_size,
                "image_size": request.image_size,
                "device": request.device,
                "optimizer": request.optimizer,
                "learning_rate": request.learning_rate,
                "weight_decay": request.weight_decay,
                "save_period": request.save_period,
                "remove_images_without_annotations": request.remove_images_without_annotations,
                "dji_patch_path": request.dji_patch_path,
                "dji_use_widen_factor_025": request.dji_use_widen_factor_025,
                "use_wandb": request.use_wandb,
                "wandb_project": request.wandb_project,
                "wandb_entity": request.wandb_entity,
            }

            if USE_CELERY and celery_mmyolo_task is not None:
                celery_task = celery_mmyolo_task.delay(task.id, training_config)
                logger.info(
                    f"Queued rerun MMYOLO training task {task.id} in Celery (celery_id: {celery_task.id}, rerun of {task_id})"
                )
                task.task_metadata = {**task.task_metadata, "celery_task_id": celery_task.id}
                db.commit()
            else:
                logger.warning("Celery not available; MMYOLO rerun cannot run without Celery worker.")
                task.status = "failed"
                task.error_message = "Celery worker not available — cannot start MMYOLO rerun."
                db.commit()
                raise HTTPException(
                    status_code=503,
                    detail="Celery worker is required for MMYOLO rerun but is not available.",
                )

            return {
                "success": True,
                "task_id": task.id,
                "original_task_id": task_id,
                "message": f"MMYOLO rerun started ({request.arch} · {request.size})",
                "task": {
                    "id": task.id,
                    "name": task.name,
                    "status": task.status,
                    "progress": task.progress,
                },
            }

        # RT-DETR rerun path (uses RT-DETR task queue and metadata shape)
        if is_rtdetr:
            rtdetr_model_type = model_variant or model_type_raw

            request_data = {
                'project_id': original_task.project_id,
                'dataset_configs': reconstructed_configs,
                'model_type': rtdetr_model_type,
                'epochs': training_params.get('epochs', metadata.get('epochs', 100)),
                'batch_size': training_params.get('batch_size', 16),
                'image_size': training_params.get('image_size', training_params.get('imgsz', 640)),
                'device': training_params.get('device', '0'),
                'task_name': f"{original_task.name} (Rerun)",
                'patience': training_params.get('patience', 50),
                'optimizer': training_params.get('optimizer', 'AdamW'),
                'learning_rate': training_params.get('learning_rate', 0.0001),
                'weight_decay': training_params.get('weight_decay', 0.0001),
                'save_period': training_params.get('save_period', -1),
                'use_wandb': metadata.get('use_wandb', False),
                'wandb_project': metadata.get('wandb_project'),
                'wandb_entity': metadata.get('wandb_entity'),
            }

            request = RTDETRTrainingRequest(**request_data)

            for config in request.dataset_configs:
                dataset = db.query(Dataset).filter(Dataset.id == config['dataset_id']).first()
                if not dataset:
                    raise HTTPException(status_code=404, detail=f"Dataset {config['dataset_id']} not found")

                ann_file = db.query(AnnotationFile).filter(
                    AnnotationFile.id == config['annotation_file_id']
                ).first()
                if not ann_file:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Annotation file {config['annotation_file_id']} not found"
                    )

            task = Task(
                project_id=request.project_id,
                name=request.task_name or f"RT-DETR Training - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} (Rerun)",
                task_type="training",
                status="queued",
                progress=0,
                task_metadata={
                    "model_type": "rtdetr",
                    "model_variant": request.model_type,
                    "training_params": request.dict(exclude={'project_id', 'dataset_configs', 'task_name'}),
                    "dataset_configs": request.dataset_configs,
                    "rerun_of_task_id": task_id,
                }
            )
            db.add(task)
            db.commit()
            db.refresh(task)

            output_dir = Path(f"projects/{request.project_id}/training/task_{task.id}")
            output_dir.mkdir(parents=True, exist_ok=True)

            dataset_info = prepare_yolo_dataset(
                db=db,
                dataset_configs=request.dataset_configs,
                output_dir=output_dir,
                model_type=request.model_type,
                remove_images_without_annotations=True
            )

            data_yaml = {
                'path': str(output_dir.absolute()),
                'train': 'images/train',
                'val': 'images/val',
                'test': 'images/test',
                'names': {i: name for i, name in enumerate(dataset_info['class_names'])},
                'nc': len(dataset_info['class_names'])
            }

            yaml_path = output_dir / "data.yaml"
            with open(yaml_path, 'w') as f:
                import yaml
                yaml.dump(data_yaml, f)

            task.task_metadata = {
                **task.task_metadata,
                "output_dir": str(output_dir),
                "data_yaml": str(yaml_path),
                "num_classes": len(dataset_info['class_names']),
                "class_names": dataset_info['class_names'],
                "classes": dataset_info['class_names']
            }
            db.commit()
            db.refresh(task)

            training_config = {
                "task_id": task.id,
                "model_type": request.model_type,
                "data_yaml": str(yaml_path),
                "epochs": request.epochs,
                "batch_size": request.batch_size,
                "image_size": request.image_size,
                "device": request.device,
                "output_dir": str(output_dir),
                "patience": request.patience,
                "optimizer": request.optimizer,
                "learning_rate": request.learning_rate,
                "weight_decay": request.weight_decay,
                "use_wandb": request.use_wandb,
                "wandb_project": request.wandb_project,
                "wandb_entity": request.wandb_entity
            }

            if USE_CELERY and celery_rtdetr_task is not None:
                celery_task = celery_rtdetr_task.delay(task.id, training_config)
                logger.info(f"Queued rerun RT-DETR training task {task.id} in Celery (task_id: {celery_task.id}, rerun of {task_id})")
                task.task_metadata = {
                    **task.task_metadata,
                    "celery_task_id": celery_task.id
                }
                db.commit()
            else:
                logger.warning("RT-DETR rerun requires Celery worker")
                raise HTTPException(status_code=500, detail="RT-DETR rerun requires Celery")

            return {
                "success": True,
                "task_id": task.id,
                "original_task_id": task_id,
                "message": "RT-DETR rerun started",
                "task": {
                    "id": task.id,
                    "name": task.name,
                    "status": task.status,
                    "progress": task.progress
                }
            }

        # Default YOLO rerun path
        model_type = model_type_raw
        
        # Reconstruct YoloTrainingRequest
        request_data = {
            'project_id': original_task.project_id,
            'dataset_configs': reconstructed_configs,
            'model_type': model_type,
            'epochs': training_params.get('epochs', metadata.get('epochs', 100)),
            'batch_size': training_params.get('batch_size', 16),
            'image_size': training_params.get('image_size', training_params.get('imgsz', 640)),
            'device': training_params.get('device', '0'),
            'task_name': f"{original_task.name} (Rerun)",
            'patience': training_params.get('patience', 50),
            'optimizer': training_params.get('optimizer', 'auto'),
            'learning_rate': training_params.get('lr0', training_params.get('learning_rate', 0.01)),
            'momentum': training_params.get('momentum', 0.937),
            'weight_decay': training_params.get('weight_decay', 0.0005),
            'save_period': training_params.get('save_period', -1),
            'augmentations': metadata.get('model_config', {}).get('augmentations'),
            'remove_images_without_annotations': metadata.get('remove_images_without_annotations', True),
            'use_wandb': metadata.get('use_wandb', False),
            'wandb_project': metadata.get('wandb_project'),
            'wandb_entity': metadata.get('wandb_entity'),
        }
        
        # Create YoloTrainingRequest
        request = YoloTrainingRequest(**request_data)
        
        # Start training using the existing endpoint logic
        # Validate datasets exist
        for config in request.dataset_configs:
            dataset = db.query(Dataset).filter(Dataset.id == config['dataset_id']).first()
            if not dataset:
                raise HTTPException(status_code=404, detail=f"Dataset {config['dataset_id']} not found")
            
            ann_file = db.query(AnnotationFile).filter(
                AnnotationFile.id == config['annotation_file_id']
            ).first()
            if not ann_file:
                raise HTTPException(
                    status_code=404,
                    detail=f"Annotation file {config['annotation_file_id']} not found"
                )
        
        # Create new task
        task_name = request.task_name or f"YOLO Training - {request.model_type} (Rerun)"
        
        # Prepare dataset configs with names for metadata
        dataset_configs_with_names = []
        for config in request.dataset_configs:
            dataset = db.query(Dataset).filter(Dataset.id == config['dataset_id']).first()
            ann_file = db.query(AnnotationFile).filter(
                AnnotationFile.id == config['annotation_file_id']
            ).first()
            
            dataset_configs_with_names.append({
                'dataset_id': config['dataset_id'],
                'dataset_name': dataset.name if dataset else None,
                'annotation_file_id': config['annotation_file_id'],
                'annotation_file_name': ann_file.name if ann_file else None,
                'image_collection': config.get('image_collection'),
                'split': config.get('split', {'train': 80, 'val': 20, 'test': 0})
            })
        
        task = Task(
            name=task_name,
            description=f"Training YOLO model with {len(request.dataset_configs)} dataset(s) (Rerun of task {task_id})",
            task_type="yolo_training",
            status="pending",
            project_id=request.project_id,
            progress=0,
            task_metadata={
                "model_type": request.model_type,
                "epochs": request.epochs,
                "batch_size": request.batch_size,
                "image_size": request.image_size,
                "dataset_count": len(request.dataset_configs),
                "dataset_ids": [config['dataset_id'] for config in request.dataset_configs],
                "dataset_configs": dataset_configs_with_names,
                "training_params": {
                    "batch_size": request.batch_size,
                    "epochs": request.epochs,
                    "image_size": request.image_size,
                    "imgsz": request.image_size,
                    "device": request.device,
                    "optimizer": request.optimizer,
                    "lr0": request.learning_rate,
                    "momentum": request.momentum,
                    "weight_decay": request.weight_decay,
                    "save_period": request.save_period,
                    "patience": request.patience
                },
                "model_config": {
                    "model": request.model_type,
                    "task": "detect",
                    "augmentations": request.augmentations or {}
                },
                "rerun_of_task_id": task_id
            }
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        
        # Prepare training config
        training_config = {
            'project_id': request.project_id,
            'dataset_configs': request.dataset_configs,
            'model_type': request.model_type,
            'epochs': request.epochs,
            'batch_size': request.batch_size,
            'image_size': request.image_size,
            'device': request.device,
            'patience': request.patience,
            'optimizer': request.optimizer,
            'learning_rate': request.learning_rate,
            'momentum': request.momentum,
            'weight_decay': request.weight_decay,
            'save_period': request.save_period,
            'augmentations': request.augmentations or {},
            'use_wandb': request.use_wandb,
            'wandb_project': request.wandb_project,
            'wandb_entity': request.wandb_entity,
        }
        
        # Start background task
        if USE_CELERY:
            # Use Celery for proper task queuing
            celery_task = celery_train_task.delay(task.id, training_config)
            logger.info(f"Queued rerun training task {task.id} in Celery (task_id: {celery_task.id}, rerun of {task_id})")
            
            # Store Celery task ID in metadata
            task.task_metadata = {
                **task.task_metadata,
                "celery_task_id": celery_task.id
            }
            db.commit()
        else:
            # Fallback to FastAPI BackgroundTasks (not recommended for production)
            logger.warning("Using BackgroundTasks instead of Celery - tasks may run concurrently!")
            background_tasks.add_task(
                train_yolo_model_task,
                task.id,
                training_config
            )
        
        return {
            "success": True,
            "task_id": task.id,
            "original_task_id": task_id,
            "message": "Training rerun started",
            "task": {
                "id": task.id,
                "name": task.name,
                "status": task.status,
                "progress": task.progress
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error rerunning training task {task_id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/training/task/{task_id}/status")
async def get_training_status(task_id: int, db: Session = Depends(get_db)):
    """Get the status of a training task"""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    return {
        "success": True,
        "task": {
            "id": task.id,
            "name": task.name,
            "status": task.status,
            "progress": task.progress,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
            "error_message": task.error_message,
            "metadata": task.task_metadata
        }
    }


@router.post("/training/rtdetr")
async def start_rtdetr_training(
    request: RTDETRTrainingRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Start RT-DETR model training using Celery task queue.
    """
    try:
        # Create task record first to get task_id
        task_name = request.task_name or f"RT-DETR Training - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        task = Task(
            project_id=request.project_id,
            name=task_name,
            task_type="training",
            status="queued",
            progress=0,
            task_metadata={
                "model_type": "rtdetr",
                "model_variant": request.model_type,
                "training_params": request.dict(exclude={'project_id', 'dataset_configs', 'task_name'}),
                "dataset_configs": request.dataset_configs,
            }
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        
        # Create output directory using task_id (same as YOLO)
        output_dir = Path(f"projects/{request.project_id}/training/task_{task.id}")
        output_dir.mkdir(parents=True, exist_ok=True)
        
        dataset_info = prepare_yolo_dataset(  # RT-DETR uses YOLO format
            db=db,
            dataset_configs=request.dataset_configs,
            output_dir=output_dir,
            model_type=request.model_type,
            remove_images_without_annotations=True  # RT-DETR should also remove images without annotations
        )
        
        # Create data.yaml for RT-DETR
        data_yaml = {
            'path': str(output_dir.absolute()),
            'train': 'images/train',
            'val': 'images/val',
            'test': 'images/test',
            'names': {i: name for i, name in enumerate(dataset_info['class_names'])},
            'nc': len(dataset_info['class_names'])
        }
        
        yaml_path = output_dir / "data.yaml"
        with open(yaml_path, 'w') as f:
            import yaml
            yaml.dump(data_yaml, f)
        
        # Update task with dataset info
        task.task_metadata = {
            **task.task_metadata,
            "output_dir": str(output_dir),
            "data_yaml": str(yaml_path),
            "num_classes": len(dataset_info['class_names']),
            "class_names": dataset_info['class_names'],
            "classes": dataset_info['class_names']
        }
        db.commit()
        db.refresh(task)
        
        training_config = {
            "task_id": task.id,
            "model_type": request.model_type,
            "data_yaml": str(yaml_path),
            "epochs": request.epochs,
            "batch_size": request.batch_size,
            "image_size": request.image_size,
            "device": request.device,
            "output_dir": str(output_dir),
            "patience": request.patience,
            "optimizer": request.optimizer,
            "learning_rate": request.learning_rate,
            "weight_decay": request.weight_decay,
            "use_wandb": request.use_wandb,
            "wandb_project": request.wandb_project,
            "wandb_entity": request.wandb_entity
        }
        
        if USE_CELERY:
            celery_task = celery_rtdetr_task.delay(task.id, training_config)
            logger.info(f"Queued RT-DETR training task {task.id} in Celery (task_id: {celery_task.id})")
            
            task.task_metadata = {
                **task.task_metadata,
                "celery_task_id": celery_task.id
            }
            db.commit()
        else:
            logger.warning("Using BackgroundTasks instead of Celery - tasks may run concurrently!")
            # Note: Would need to implement background task handler for RT-DETR
            raise HTTPException(status_code=500, detail="RT-DETR training requires Celery")

        rtd_cached = is_training_base_weights_cached(request.model_type)

        return {
            "success": True,
            "task_id": task.id,
            "message": "RT-DETR training started",
            "weights_download_expected": not rtd_cached,
            "weights_download_notice": None if rtd_cached else WEIGHTS_DOWNLOAD_NOTICE,
            "task": {
                "id": task.id,
                "name": task.name,
                "status": task.status,
                "progress": task.progress
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting RT-DETR training: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/training/{task_id}/checkpoints")
async def list_checkpoints(task_id: int, db: Session = Depends(get_db)):
    """
    List all available checkpoints for a training task.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    
    if not task:
        raise HTTPException(status_code=404, detail="Training task not found")
    
    if task.task_type not in ['yolo_training', 'training', 'mmyolo_training']:
        raise HTTPException(status_code=400, detail="Task is not a training task")
    
    task_metadata = task.task_metadata or {}
    results_dir = task_metadata.get('results_dir')
    best_model = task_metadata.get('best_model')
    last_model = task_metadata.get('last_model')
    yolo_best_model = task_metadata.get('yolo_best_model')
    yolo_last_model = task_metadata.get('yolo_last_model')
    yolo_results_dir = task_metadata.get('yolo_results_dir')
    
    checkpoints = []
    checkpoint_names_seen = set()  # Track which checkpoints we've already added
    
    # Add best and last models if available (prefer expected location, fallback to YOLO)
    if best_model and Path(best_model).exists():
        size = Path(best_model).stat().st_size if Path(best_model).exists() else None
        checkpoints.append({
            'name': 'best',
            'path': best_model,
            'epoch': None,
            'size': size
        })
        checkpoint_names_seen.add('best.pt')
    elif yolo_best_model and Path(yolo_best_model).exists():
        size = Path(yolo_best_model).stat().st_size if Path(yolo_best_model).exists() else None
        checkpoints.append({
            'name': 'best',
            'path': yolo_best_model,
            'epoch': None,
            'size': size
        })
        checkpoint_names_seen.add('best.pt')
    
    if last_model and Path(last_model).exists():
        size = Path(last_model).stat().st_size if Path(last_model).exists() else None
        checkpoints.append({
            'name': 'last',
            'path': last_model,
            'epoch': None,
            'size': size
        })
        checkpoint_names_seen.add('last.pt')
    elif yolo_last_model and Path(yolo_last_model).exists():
        size = Path(yolo_last_model).stat().st_size if Path(yolo_last_model).exists() else None
        checkpoints.append({
            'name': 'last',
            'path': yolo_last_model,
            'epoch': None,
            'size': size
        })
        checkpoint_names_seen.add('last.pt')
    
    # Look for additional checkpoints in weights directory (expected location)
    if results_dir:
        weights_dir = Path(results_dir) / "weights"
        if weights_dir.exists():
            # Look for epoch checkpoints (e.g., epoch10.pt, epoch20.pt)
            for checkpoint_file in list(weights_dir.glob("*.pt")) + list(weights_dir.glob("*.pth")):
                if checkpoint_file.name not in checkpoint_names_seen:
                    # Try to extract epoch number from filename
                    epoch_match = re.search(r'epoch(\d+)', checkpoint_file.name, re.IGNORECASE)
                    epoch = int(epoch_match.group(1)) if epoch_match else None
                    
                    size = checkpoint_file.stat().st_size if checkpoint_file.exists() else None
                    checkpoints.append({
                        'name': checkpoint_file.name,
                        'path': str(checkpoint_file),
                        'epoch': epoch,
                        'size': size
                    })
                    checkpoint_names_seen.add(checkpoint_file.name)
    
    # Also check YOLO location for additional checkpoints
    if yolo_results_dir:
        yolo_weights_dir = Path(yolo_results_dir) / "weights"
        if yolo_weights_dir.exists():
            for checkpoint_file in list(yolo_weights_dir.glob("*.pt")) + list(yolo_weights_dir.glob("*.pth")):
                if checkpoint_file.name not in checkpoint_names_seen:
                    # Try to extract epoch number from filename
                    epoch_match = re.search(r'epoch(\d+)', checkpoint_file.name, re.IGNORECASE)
                    epoch = int(epoch_match.group(1)) if epoch_match else None
                    
                    size = checkpoint_file.stat().st_size if checkpoint_file.exists() else None
                    checkpoints.append({
                        'name': checkpoint_file.name,
                        'path': str(checkpoint_file),
                        'epoch': epoch,
                        'size': size
                    })
                    checkpoint_names_seen.add(checkpoint_file.name)
    
    # Sort by epoch if available, otherwise by name
    checkpoints.sort(key=lambda x: (x['epoch'] if x['epoch'] is not None else 9999, x['name']))
    
    return {
        "success": True,
        "checkpoints": checkpoints
    }


@router.get("/training/{task_id}/download")
async def download_checkpoint(
    task_id: int,
    checkpoint: str = Query(..., description="Checkpoint name (e.g., 'best', 'last', 'epoch10.pt')"),
    db: Session = Depends(get_db)
):
    """
    Download a specific checkpoint from a training task.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    
    if not task:
        raise HTTPException(status_code=404, detail="Training task not found")
    
    if task.task_type not in ['yolo_training', 'training', 'mmyolo_training']:
        raise HTTPException(status_code=400, detail="Task is not a training task")
    
    task_metadata = task.task_metadata or {}
    results_dir = task_metadata.get('results_dir')
    best_model = task_metadata.get('best_model')
    last_model = task_metadata.get('last_model')
    yolo_best_model = task_metadata.get('yolo_best_model')
    yolo_last_model = task_metadata.get('yolo_last_model')
    yolo_results_dir = task_metadata.get('yolo_results_dir')
    
    model_path = None
    
    # Check for best/last models (prefer expected location, fallback to YOLO location)
    if checkpoint == 'best':
        if best_model:
            model_path = Path(best_model)
        elif yolo_best_model:
            model_path = Path(yolo_best_model)
    elif checkpoint == 'last':
        if last_model:
            model_path = Path(last_model)
        elif yolo_last_model:
            model_path = Path(yolo_last_model)
    elif results_dir:
        # Look in weights directory
        weights_dir = Path(results_dir) / "weights"
        if weights_dir.exists():
            # Try exact match first
            potential_path = weights_dir / checkpoint
            if potential_path.exists() and potential_path.suffix in {'.pt', '.pth'}:
                model_path = potential_path
            else:
                # Try with common extensions if not provided
                for ext in ('.pt', '.pth'):
                    potential = weights_dir / f"{checkpoint}{ext}"
                    if potential.exists():
                        model_path = potential
                        break
    
    # If not found in expected location, check YOLO location
    if (not model_path or not model_path.exists()) and yolo_results_dir:
        yolo_weights_dir = Path(yolo_results_dir) / "weights"
        if yolo_weights_dir.exists():
            potential_path = yolo_weights_dir / checkpoint
            if potential_path.exists() and potential_path.suffix in {'.pt', '.pth'}:
                model_path = potential_path
            else:
                for ext in ('.pt', '.pth'):
                    potential = yolo_weights_dir / f"{checkpoint}{ext}"
                    if potential.exists():
                        model_path = potential
                        break
    
    if not model_path or not model_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Checkpoint '{checkpoint}' not found for task {task_id}"
        )
    
    # Sanitize filename for download
    safe_filename = re.sub(r'[<>:"/\\|?*]', '_', task.name)
    safe_filename = safe_filename.strip('. ')
    if not safe_filename:
        safe_filename = f"model_{task_id}"
    
    # Add checkpoint name to filename
    checkpoint_name = checkpoint.replace('.pt', '')
    download_filename = f"{safe_filename}_{checkpoint_name}.zip"

    # Collect class names from task metadata (best-effort fallbacks)
    class_names = []
    if isinstance(task_metadata.get("class_names"), list):
        class_names = [str(c) for c in task_metadata.get("class_names", [])]
    elif isinstance(task_metadata.get("dataset_info"), dict):
        ds_info = task_metadata.get("dataset_info") or {}
        if isinstance(ds_info.get("class_names"), list):
            class_names = [str(c) for c in ds_info.get("class_names", [])]

    # Build zip in-memory: selected .pt + class names text/json
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        model_filename = model_path.name if model_path.suffix.lower() == ".pt" else f"{checkpoint_name}.pt"
        zf.write(str(model_path), arcname=model_filename)

        if class_names:
            zf.writestr("classes.txt", "\n".join(class_names) + "\n")
            zf.writestr("classes.json", json.dumps({"class_names": class_names}, indent=2))
        else:
            zf.writestr("classes.txt", "")
            zf.writestr("classes.json", json.dumps({"class_names": []}, indent=2))

        zf.writestr(
            "metadata.json",
            json.dumps(
                {
                    "task_id": task_id,
                    "task_name": task.name,
                    "checkpoint": checkpoint_name,
                    "model_file": model_filename,
                },
                indent=2,
            ),
        )

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{download_filename}"'},
    )


@router.post("/training/{task_id}/test-inference")
async def test_training_model_inference(
    task_id: int,
    image: UploadFile = File(...),
    checkpoint: str = Query("best", description="Checkpoint to use (best, last, or specific checkpoint)"),
    db: Session = Depends(get_db)
):
    """
    Test YOLO .pt model inference on an uploaded image.
    Returns predictions with bounding boxes and confidence scores.
    """
    try:
        # Verify the training task exists
        task = db.query(Task).filter(Task.id == task_id).first()
        
        if not task:
            raise HTTPException(status_code=404, detail="Training task not found")
        
        if task.task_type not in ['yolo_training', 'training', 'mmyolo_training']:
            raise HTTPException(status_code=400, detail="Task is not a training task")
        
        if task.status != 'completed':
            raise HTTPException(
                status_code=400,
                detail=f"Training task is not completed. Current status: {task.status}"
            )
        
        # Get model path based on checkpoint
        task_metadata = task.task_metadata or {}
        is_mmyolo = task.task_type == 'mmyolo_training'

        # --- MMYOLO: use the dedicated resolver (handles .pth naming conventions) ---
        if is_mmyolo:
            from app.tasks.mmyolo_evaluation import resolve_mmyolo_checkpoint
            model_path = resolve_mmyolo_checkpoint(task_metadata, checkpoint)
            if not model_path or not Path(model_path).exists():
                raise HTTPException(
                    status_code=404,
                    detail=f"Model checkpoint '{checkpoint}' not found for task {task_id}. "
                           f"Looked in results_dir='{task_metadata.get('results_dir')}'. "
                           f"best_model='{task_metadata.get('best_model')}'"
                )
        else:
            model_path = None
            if checkpoint == "best":
                model_path = task_metadata.get('best_model')
            elif checkpoint == "last":
                model_path = task_metadata.get('last_model')
            elif task_metadata.get('results_dir'):
                weights_dir = Path(task_metadata['results_dir']) / "weights"
                if weights_dir.exists():
                    potential_path = weights_dir / checkpoint
                    if potential_path.exists() and potential_path.suffix in {'.pt', '.pth'}:
                        model_path = str(potential_path)
                    else:
                        for ext in ('.pt', '.pth'):
                            candidate = weights_dir / f"{checkpoint}{ext}"
                            if candidate.exists():
                                model_path = str(candidate)
                                break

            if not model_path or not Path(model_path).exists():
                raise HTTPException(
                    status_code=404,
                    detail=f"Model checkpoint '{checkpoint}' not found for task {task_id}"
                )
        
        # Get class names from task metadata
        class_names = task_metadata.get('class_names', [])

        # ── MMYOLO inference — runs directly in the backend via /opt/mmyolo-venv ──
        # The backend image now includes a CPU MMYOLO venv so inference is instant
        # and never blocks behind a training job running in celery_worker.
        if is_mmyolo:
            from app.tasks.mmyolo_evaluation import (
                MMYOLO_INFERENCE_SCRIPT,
                resolve_mmyolo_config_path,
                _build_mmyolo_eval_env,
            )
            from app.tasks.training_common import MMYOLO_PYTHON

            config_path = resolve_mmyolo_config_path(task_id, task_metadata)
            if not config_path:
                raise HTTPException(
                    status_code=400,
                    detail="MMYOLO config file not found. Expected at "
                           f"projects/<project_id>/training/task_{task_id}/mmyolo_config.py"
                )
            if not Path(MMYOLO_PYTHON).exists():
                raise HTTPException(
                    status_code=500,
                    detail=f"MMYOLO Python environment not found at {MMYOLO_PYTHON}. "
                           "Rebuild the backend image to include the MMYOLO venv."
                )

            content = await image.read()
            with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as tmp_img:
                tmp_img_path = tmp_img.name
                tmp_img.write(content)

            try:
                output_dir = Path(tempfile.gettempdir()) / f"mmyolo_inf_{uuid.uuid4().hex[:8]}"
                output_dir.mkdir(exist_ok=True)
                input_json = output_dir / "input.json"
                output_json_path = output_dir / "output.json"

                input_json.write_text(
                    json.dumps([{"image_id": 0, "path": tmp_img_path}]), encoding="utf-8"
                )
                env = _build_mmyolo_eval_env(
                    device="cpu",  # backend container is CPU-only
                    dji_repo_dir=task_metadata.get("dji_repo_dir"),
                )
                cmd = [
                    MMYOLO_PYTHON,
                    str(MMYOLO_INFERENCE_SCRIPT),
                    "--config", config_path,
                    "--checkpoint", model_path,
                    "--input-json", str(input_json),
                    "--output-json", str(output_json_path),
                    "--num-classes", str(len(class_names)),
                    "--conf", "0.25",
                    "--device", "cpu",
                ]
                proc = subprocess.run(
                    cmd, capture_output=True, text=True, env=env, cwd=str(Path.cwd())
                )
                if proc.returncode != 0:
                    err = (proc.stderr or proc.stdout or "").strip()[-1500:]
                    raise HTTPException(status_code=500, detail=f"MMYOLO inference failed: {err}")

                preds_raw = []
                if output_json_path.exists():
                    preds_raw = json.loads(output_json_path.read_text(encoding="utf-8"))

                predictions = []
                for p in preds_raw:
                    bbox_xyxy = p.get("bbox", [])
                    if len(bbox_xyxy) == 4:
                        x1, y1, x2, y2 = bbox_xyxy
                        bbox_xywh = [x1, y1, x2 - x1, y2 - y1]
                    else:
                        bbox_xywh = []
                    class_id = p.get("class_id", 0)
                    class_name = (
                        class_names[class_id] if class_id < len(class_names)
                        else f"class_{class_id}"
                    )
                    predictions.append({
                        "bbox": bbox_xywh,
                        "confidence": float(p.get("confidence", 0)),
                        "class_id": class_id,
                        "class": class_name,
                        "segmentation": p.get("segmentation", []),
                    })

                static_dir = Path("static/inference_results")
                static_dir.mkdir(parents=True, exist_ok=True)
                annotated_filename = f"annotated_{task_id}_{uuid.uuid4().hex[:8]}.jpg"
                import shutil as _shutil
                _shutil.copy2(tmp_img_path, str(static_dir / annotated_filename))

                return JSONResponse({
                    "success": True,
                    "predictions": predictions,
                    "image_url": f"/static/inference_results/{annotated_filename}",
                    "model_path": model_path,
                })
            finally:
                os.unlink(tmp_img_path)
                import shutil as _shutil
                _shutil.rmtree(str(output_dir), ignore_errors=True)

        # ── Ultralytics YOLO inference (regular training tasks) ─────────────────
        # Save uploaded image to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as tmp_image:
            tmp_image_path = tmp_image.name
            content = await image.read()
            tmp_image.write(content)
        
        try:
            # Create temporary output directory
            output_dir = Path(tempfile.gettempdir()) / f"inference_{uuid.uuid4().hex[:8]}"
            output_dir.mkdir(exist_ok=True)
            
            # Create Python script for inference using YOLO
            script_path = output_dir / "run_inference.py"
            result_json_path = output_dir / "results.json"
            annotated_image_path = output_dir / "annotated.jpg"
            
            # Generate the inference script using YOLO
            inference_script = """import importlib, sys

def _load_yolo():
    for _path in ("ultralytics", "ultralytics.models.yolo.model", "ultralytics.models.yolo", "ultralytics.models"):
        try:
            _m = importlib.import_module(_path)
            return _m.YOLO
        except Exception:
            pass
    raise ImportError("Cannot import YOLO from ultralytics")

YOLO = _load_yolo()

import cv2
import json
import numpy as np

# Main inference
model_path = sys.argv[1]
image_path = sys.argv[2]
output_json = sys.argv[3]
output_image = sys.argv[4]
class_names_json = sys.argv[5] if len(sys.argv) > 5 else '[]'

import json as json_module
class_names = json_module.loads(class_names_json)

# Load YOLO model
model = YOLO(model_path)

# Run inference
results = model(image_path, conf=0.25, iou=0.45)

# Process results
predictions = []
annotated_img = None

if results and len(results) > 0:
    result = results[0]
    
    # Get annotated image (this will show masks if available)
    annotated_img = result.plot()
    
    # Extract predictions
    if result.boxes is not None:
        boxes = result.boxes
        has_masks = result.masks is not None
        
        for i in range(len(boxes)):
            # Get box coordinates (xyxy format)
            box = boxes.xyxy[i].cpu().numpy()
            x1, y1, x2, y2 = float(box[0]), float(box[1]), float(box[2]), float(box[3])
            
            # Get confidence and class
            confidence = float(boxes.conf[i].cpu().numpy())
            class_id = int(boxes.cls[i].cpu().numpy())
            
            # Get class name
            class_name = class_names[class_id] if class_id < len(class_names) else f'Class {class_id}'
            
            pred = {
                'bbox': [x1, y1, x2 - x1, y2 - y1],
                'confidence': confidence,
                'class_id': class_id,
                'class': class_name
            }
            
            # Extract segmentation mask if available
            if has_masks and result.masks is not None:
                try:
                    mask = result.masks.data[i].cpu().numpy()
                    # Get original image dimensions from result
                    orig_shape = result.orig_shape  # (height, width)
                    mask_shape = mask.shape  # (height, width) or (1, height, width)
                    
                    # Handle different mask formats
                    if len(mask_shape) == 3:
                        mask = mask[0]  # Remove batch dimension if present
                    
                    # Resize mask to original image size if needed
                    if mask.shape != orig_shape[:2]:
                        mask_resized = cv2.resize(mask, (orig_shape[1], orig_shape[0]), interpolation=cv2.INTER_NEAREST)
                    else:
                        mask_resized = mask
                    
                    # Convert mask to polygon (contour)
                    mask_binary = (mask_resized > 0.5).astype(np.uint8) * 255
                    contours, _ = cv2.findContours(
                        mask_binary,
                        cv2.RETR_EXTERNAL,
                        cv2.CHAIN_APPROX_SIMPLE
                    )
                    if len(contours) > 0:
                        # Get the largest contour
                        largest_contour = max(contours, key=cv2.contourArea)
                        # Simplify contour to reduce points (but keep enough detail)
                        epsilon = 0.001 * cv2.arcLength(largest_contour, True)
                        approx = cv2.approxPolyDP(largest_contour, epsilon, True)
                        # Flatten to [x1, y1, x2, y2, ...] format
                        if len(approx) >= 3:  # Need at least 3 points for a polygon
                            polygon = approx.reshape(-1, 2).flatten().tolist()
                            pred['segmentation'] = [polygon]
                except Exception as e:
                    # If mask extraction fails, just skip it and use bbox only
                    import traceback
                    print(f"Warning: Failed to extract mask for prediction {i}: {e}")
                    traceback.print_exc()
            
            predictions.append(pred)

# Save annotated image
if annotated_img is not None:
    cv2.imwrite(output_image, annotated_img)

# Save results
results_data = {
    'predictions': predictions,
    'num_predictions': len(predictions)
}

with open(output_json, 'w') as f:
    json.dump(results_data, f, indent=2)

print(f"Found {len(predictions)} predictions")
"""
            
            with open(script_path, 'w') as f:
                f.write(inference_script)
            
            # Run inference script
            python_executable = sys.executable
            
            class_names_json = json.dumps(class_names)
            cmd = [
                python_executable,
                str(script_path),
                str(model_path),
                tmp_image_path,
                str(result_json_path),
                str(annotated_image_path),
                class_names_json
            ]
            
            logger.info(f"Running inference with command: {' '.join(cmd)}")
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
                env=os.environ.copy()
            )
            
            if result.returncode != 0:
                error_msg = result.stderr or result.stdout or "Unknown error"
                logger.error(f"Inference script error: {error_msg}")
                raise Exception(f"Inference failed: {error_msg}")
            
            # Read results
            with open(result_json_path, 'r') as f:
                inference_results = json.load(f)
            
            # Copy annotated image to static directory for serving
            static_dir = Path("static/inference_results")
            static_dir.mkdir(parents=True, exist_ok=True)
            annotated_filename = f"annotated_{task_id}_{uuid.uuid4().hex[:8]}.jpg"
            annotated_static_path = static_dir / annotated_filename
            shutil.copy2(str(annotated_image_path), str(annotated_static_path))
            
            # Cleanup temporary files
            os.unlink(tmp_image_path)
            shutil.rmtree(output_dir, ignore_errors=True)
            
            return JSONResponse({
                "success": True,
                "result": {
                    "predictions": inference_results.get('predictions', []),
                    "image_url": f"/static/inference_results/{annotated_filename}"
                }
            })
            
        except Exception as e:
            # Cleanup on error
            if os.path.exists(tmp_image_path):
                os.unlink(tmp_image_path)
            logger.error(f"Error running inference: {str(e)}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in test inference: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")


# ── MMYOLO endpoint ──────────────────────────────────────────────────────────

@router.post("/training/mmyolo/dji-patch")
async def upload_mmyolo_dji_patch(file: UploadFile = File(...)):
    """Upload DJI AI Inside patch file used to modify MMYOLO before training."""
    try:
        logger.info(f"Received DJI patch upload request: filename={file.filename}, content_type={file.content_type}")
        
        filename = file.filename or ""
        if not filename.lower().endswith(".patch"):
            logger.warning(f"Invalid file extension for DJI patch: {filename}")
            raise HTTPException(status_code=400, detail="Only .patch files are supported.")

        patch_dir = Path(os.environ.get("DJI_PATCH_STORAGE_DIR", "/app/data/dji_patches"))
        logger.info(f"Using patch storage directory: {patch_dir}")
        
        try:
            patch_dir.mkdir(parents=True, exist_ok=True)
        except Exception as dir_error:
            logger.error(f"Failed to create patch directory {patch_dir}: {dir_error}")
            raise HTTPException(status_code=500, detail=f"Failed to create storage directory: {str(dir_error)}")

        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename).name)
        stored_name = f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{safe_name}"
        stored_path = patch_dir / stored_name
        
        logger.info(f"Saving patch to: {stored_path}")

        try:
            with open(stored_path, "wb") as out:
                content = await file.read()
                out.write(content)
                logger.info(f"Successfully wrote {len(content)} bytes to {stored_path}")
        except Exception as write_error:
            logger.error(f"Failed to write patch file: {write_error}")
            raise HTTPException(status_code=500, detail=f"Failed to save file: {str(write_error)}")

        result = {
            "success": True,
            "patch_name": safe_name,
            "patch_path": str(stored_path),
            "uploaded_at": datetime.utcnow().isoformat() + "Z",
            "message": "DJI patch uploaded successfully.",
        }
        logger.info(f"DJI patch upload successful: {result}")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Failed to upload DJI patch: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))

@router.post("/training/mmyolo")
async def start_mmyolo_training(
    request: MMYOLOTrainingRequest,
    db: Session = Depends(get_db),
):
    """
        Start MMYOLO (YOLOv8 + RTMDet family) training.

    Supported architectures:
            - yolov8      → YOLOv8 detection
      - rtmdet      → RTMDet detection
      - rtmdet-ins  → RTMDet instance segmentation
      - rtmdet-r    → RTMDet-Rotated oriented bounding boxes

    Training runs via `mim run mmyolo train` inside the Celery worker.
    """
    try:
        # Validate arch+size combination
        try:
            config_id = mmyolo_config_name(request.arch, request.size)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

        # Validate datasets and annotation files exist
        for cfg in request.dataset_configs:
            dataset = db.query(Dataset).filter(Dataset.id == cfg["dataset_id"]).first()
            if not dataset:
                raise HTTPException(
                    status_code=404, detail=f"Dataset {cfg['dataset_id']} not found"
                )
            ann_file = db.query(AnnotationFile).filter(
                AnnotationFile.id == cfg["annotation_file_id"]
            ).first()
            if not ann_file:
                raise HTTPException(
                    status_code=404,
                    detail=f"Annotation file {cfg['annotation_file_id']} not found",
                )

        if request.dji_patch_path:
            patch_path = Path(request.dji_patch_path)
            if not patch_path.exists() or not patch_path.is_file():
                raise HTTPException(status_code=400, detail="Provided DJI patch file does not exist.")
            if patch_path.suffix.lower() != ".patch":
                raise HTTPException(status_code=400, detail="DJI patch must be a .patch file.")

        task_name = (
            request.task_name
            or f"MMYOLO {request.arch.upper()} ({request.size.upper()}) — "
               f"{datetime.utcnow().strftime('%Y-%m-%d %H:%M')}"
        )

        task = Task(
            name=task_name,
            description=(
                f"MMYOLO training: {request.arch} · {request.size} · {request.task} "
                f"on {len(request.dataset_configs)} dataset(s)"
            ),
            task_type="mmyolo_training",
            status="pending",
            project_id=request.project_id,
            progress=0,
            task_metadata={
                "model_type": f"{request.arch}_{request.size}",
                "arch": request.arch,
                "size": request.size,
                "mmyolo_task": request.task,
                "config_id": config_id,
                "epochs": request.epochs,
                "batch_size": request.batch_size,
                "image_size": request.image_size,
                "dataset_count": len(request.dataset_configs),
                "dataset_ids": [c["dataset_id"] for c in request.dataset_configs],
                "dataset_configs": request.dataset_configs,
                "training_params": {
                    "epochs": request.epochs,
                    "batch_size": request.batch_size,
                    "image_size": request.image_size,
                    "device": request.device,
                    "optimizer": request.optimizer,
                    "learning_rate": request.learning_rate,
                    "weight_decay": request.weight_decay,
                    "save_period": request.save_period,
                },
                "remove_images_without_annotations": request.remove_images_without_annotations,
                "dji_patch_path": request.dji_patch_path,
                "use_wandb": request.use_wandb,
                "wandb_project": request.wandb_project,
                "wandb_entity": request.wandb_entity,
            },
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        training_config = {
            "project_id": request.project_id,
            "dataset_configs": request.dataset_configs,
            "arch": request.arch,
            "size": request.size,
            "task": request.task,
            "config_id": config_id,
            "epochs": request.epochs,
            "batch_size": request.batch_size,
            "image_size": request.image_size,
            "device": request.device,
            "optimizer": request.optimizer,
            "learning_rate": request.learning_rate,
            "weight_decay": request.weight_decay,
            "save_period": request.save_period,
            "remove_images_without_annotations": request.remove_images_without_annotations,
            "dji_patch_path": request.dji_patch_path,
            "dji_use_widen_factor_025": request.dji_use_widen_factor_025,
            "use_wandb": request.use_wandb,
            "wandb_project": request.wandb_project,
            "wandb_entity": request.wandb_entity,
        }

        if USE_CELERY and celery_mmyolo_task is not None:
            celery_task = celery_mmyolo_task.delay(task.id, training_config)
            logger.info(
                f"Queued MMYOLO training task {task.id} in Celery (celery_id: {celery_task.id})"
            )
            task.task_metadata = {**task.task_metadata, "celery_task_id": celery_task.id}
            db.commit()
        else:
            logger.warning("Celery not available; MMYOLO training cannot run without Celery worker.")
            task.status = "failed"
            task.error_message = "Celery worker not available — cannot start MMYOLO training."
            db.commit()
            raise HTTPException(
                status_code=503,
                detail="Celery worker is required for MMYOLO training but is not available.",
            )

        return {
            "success": True,
            "task_id": task.id,
            "message": f"MMYOLO training started ({request.arch} · {request.size})",
            "task": {
                "id": task.id,
                "name": task.name,
                "status": task.status,
                "progress": task.progress,
            },
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error starting MMYOLO training: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))

