"""
Detect whether foundation/training weights are already under /app/models or /app/ai_models
(Docker bake or `lai download-models`).
"""

from __future__ import annotations

from pathlib import Path

from app.foundation_models import auto_annotate_yolo_onnx_name

PRETRAINED_MODELS_DIR = Path("/app/models")
DEPTH_MODELS_DIR = Path("/app/ai_models/depth_estimation")

WEIGHTS_DOWNLOAD_NOTICE = (
    "Auto-Annotate ONNX weights are not in the local cache. Run "
    "`lai download-models` (exports YOLO11m ONNX via worker-gpu) before starting."
)


def foundation_yolo_pt_name(model_name: str, task_type: str) -> str:
    """Legacy .pt naming (training / other flows)."""
    suffix_map = {"detect": "", "segment": "-seg", "classify": "-cls"}
    suf = suffix_map.get((task_type or "detect").lower(), "")
    return f"{model_name}{suf}.pt"


def is_auto_annotate_yolo_onnx_cached(task_type: str) -> bool:
    onnx_name = auto_annotate_yolo_onnx_name(task_type)
    return (PRETRAINED_MODELS_DIR / onnx_name).is_file()


def is_foundation_yolo_cached(model_name: str, task_type: str) -> bool:
    """Backward-compatible alias — Auto-Annotate checks ONNX, not .pt."""
    return is_auto_annotate_yolo_onnx_cached(task_type)


def is_depth_onnx_cached(model_size: str, environment: str) -> bool:
    fn = f"depth_anything_v2_{model_size}_{environment}_dynamic.onnx"
    return (DEPTH_MODELS_DIR / fn).is_file()


def is_training_base_weights_cached(model_type: str) -> bool:
    """
    Training uses model_type like yolo11n-seg.pt or rtdetr-l.pt — same resolution as training.py
    (Path exists, else PRETRAINED_MODELS_DIR / basename).
    """
    mt = (model_type or "").strip()
    if not mt.endswith(".pt"):
        mt = f"{mt}.pt"
    p = Path(mt)
    if p.is_file():
        return True
    return (PRETRAINED_MODELS_DIR / p.name).is_file()
