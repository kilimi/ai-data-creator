"""
Single source of truth for Ultralytics foundation (.pt) names used by:
- Docker pre-download (scripts/download_ultralytics_models.py)
- install.sh / LAI_PRETRAINED_MODELS
- API validation (auto-annotate pretrained list)

Must stay aligned with AutoAnnotateModal / ExportModelModal (YOLO_ARCHS + sizes + detect/seg/cls).
"""
from __future__ import annotations

# (architecture id, size letter) — same matrix as scripts/download_ultralytics_models.py
ARCH_SIZES: tuple[tuple[str, str], ...] = (
    ("yolov8", "n"),
    ("yolov8", "s"),
    ("yolov8", "m"),
    ("yolov8", "l"),
    ("yolov8", "x"),
    ("yolo11", "n"),
    ("yolo11", "s"),
    ("yolo11", "m"),
    ("yolo11", "l"),
    ("yolo11", "x"),
    ("yolo26", "n"),
    ("yolo26", "s"),
    ("yolo26", "m"),
    ("yolo26", "l"),
    ("yolo26", "x"),
    ("rtdetr", "l"),
    ("rtdetr", "x"),
)

# Task variants baked for offline use: detect, segment, classify
TASK_SUFFIXES: tuple[str, ...] = ("", "-seg", "-cls")

# Allowed install / LAI_PRETRAINED_MODELS arch tokens (prefix match on base name)
KNOWN_ARCH_PREFIXES: tuple[str, ...] = (
    "yolov8",
    "yolo8",  # alias -> yolov8
    "yolo11",
    "yolo26",
    "rtdetr",
)


def ultralytics_foundation_pt_names() -> list[str]:
    """All .pt filenames for the full foundation matrix."""
    names: list[str] = []
    for arch, size in ARCH_SIZES:
        base = f"{arch}{size}"
        for suf in TASK_SUFFIXES:
            names.append(f"{base}{suf}.pt" if suf else f"{base}.pt")
    return names


# Small default image: YOLOv8 + YOLO11 nano/small × three heads
MINIMAL_ULTRALYTICS_PT: tuple[str, ...] = (
    "yolov8n.pt",
    "yolov8n-seg.pt",
    "yolov8n-cls.pt",
    "yolov8s.pt",
    "yolov8s-seg.pt",
    "yolov8s-cls.pt",
    "yolo11n.pt",
    "yolo11n-seg.pt",
    "yolo11n-cls.pt",
    "yolo11s.pt",
    "yolo11s-seg.pt",
    "yolo11s-cls.pt",
)

# Depth-Anything ONNX files (under ai_models/depth_estimation)
DEPTH_ONNX_NAMES: tuple[str, ...] = tuple(
    f"depth_anything_v2_{size}_{env}_dynamic.onnx"
    for size in ("vits", "vitb", "vitl")
    for env in ("indoor", "outdoor")
)

MINIMAL_DEPTH_ONNX: tuple[str, ...] = ("depth_anything_v2_vitb_outdoor_dynamic.onnx",)


def resolve_ultralytics_pretrained_spec(spec: str | None) -> list[str]:
    """
    Resolve LAI_PRETRAINED_MODELS value to a list of .pt filenames.

    - none / on_demand / runtime: bake nothing into the image; Ultralytics downloads at train/auto-annotate time
    - all / empty: full matrix
    - minimal: MINIMAL_ULTRALYTICS_PT (must exist in full matrix)
    - comma-separated:
        - arch tokens: yolo11, yolo26, rtdetr (prefix match on base name)
        - exact files: yolo11n-seg.pt
    """
    full = set(ultralytics_foundation_pt_names())
    s = (spec or "").strip()
    sl = s.lower()
    if sl in ("none", "on_demand", "runtime", "download_on_request"):
        return []
    if not s or sl == "all":
        return sorted(full)

    tokens = [t.strip() for t in s.split(",") if t.strip()]
    out: set[str] = set()

    for t in tokens:
        tl = t.lower()
        token_prefix = "yolov8" if tl == "yolo8" else tl
        if tl == "all":
            return sorted(full)
        if tl == "minimal":
            out.update(m for m in MINIMAL_ULTRALYTICS_PT if m in full)
            continue
        if tl.endswith(".pt"):
            if tl in full:
                out.add(tl)
            continue
        if tl not in KNOWN_ARCH_PREFIXES:
            continue
        for name in full:
            stem = name[:-3]  # drop .pt
            base = stem.replace("-seg", "").replace("-cls", "")
            if base.startswith(token_prefix):
                out.add(name)

    resolved = sorted(out)
    if not resolved:
        return sorted(m for m in MINIMAL_ULTRALYTICS_PT if m in full)
    return resolved


def resolve_depth_models_spec(spec: str | None) -> list[str]:
    """Resolve LAI_DEPTH_MODELS: none | all | minimal | comma-separated filenames."""
    full = list(DEPTH_ONNX_NAMES)
    s = (spec or "").strip()
    sl = s.lower()
    if sl in ("none", "on_demand", "runtime", "download_on_request"):
        return []
    if not s or sl == "all":
        return full
    if s.lower() == "minimal":
        return [f for f in MINIMAL_DEPTH_ONNX if f in DEPTH_ONNX_NAMES]
    names = [t.strip() for t in s.split(",") if t.strip()]
    resolved = [n for n in names if n in DEPTH_ONNX_NAMES]
    if not resolved:
        return [f for f in MINIMAL_DEPTH_ONNX if f in DEPTH_ONNX_NAMES]
    return resolved


def pretrained_yolo_catalog() -> dict[str, dict]:
    """Metadata for legacy /auto-annotate/pretrained-models API (COCO)."""
    catalog: dict[str, dict] = {}
    for name in ultralytics_foundation_pt_names():
        stem = name[:-3]
        if stem.endswith("-seg"):
            mtype = "segmentation"
        elif stem.endswith("-cls"):
            mtype = "classification"
        else:
            mtype = "detection"
        catalog[name] = {
            "name": stem,
            "type": mtype,
            "classes": 80,
        }
    return catalog
