"""
Detect whether foundation/training weights are already under /app/models or /app/ai_models
(Docker bake). If not, Ultralytics or depth code will download on first use.
"""

from __future__ import annotations

from pathlib import Path

PRETRAINED_MODELS_DIR = Path("/app/models")
DEPTH_MODELS_DIR = Path("/app/ai_models/depth_estimation")

WEIGHTS_DOWNLOAD_NOTICE = (
    "These weights are not in the local image cache. They will be downloaded when the job runs "
    "(internet required; the first run may take longer)."
)


def foundation_yolo_pt_name(model_name: str, task_type: str) -> str:
    """Same naming as load_yolo_model() in preannotate.py."""
    suffix_map = {"detect": "", "segment": "-seg", "classify": "-cls"}
    suf = suffix_map.get((task_type or "detect").lower(), "")
    return f"{model_name}{suf}.pt"


def is_foundation_yolo_cached(model_name: str, task_type: str) -> bool:
    return (PRETRAINED_MODELS_DIR / foundation_yolo_pt_name(model_name, task_type)).is_file()


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
