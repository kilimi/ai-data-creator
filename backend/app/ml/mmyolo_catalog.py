"""MMYOLO arch/size catalog and config name resolution."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

MMYOLO_VALID_ARCHS: frozenset = frozenset({"yolov8", "rtmdet", "rtmdet-ins", "rtmdet-r"})
MMYOLO_VALID_SIZES: frozenset = frozenset({"tiny", "s", "m", "l", "x"})

# OpenMMLab COCO checkpoints (see configs/*/metafile.yml). Base runtime sets load_from=None;
# Ultralytics always starts from pretrained weights — we must set this explicitly for MMYOLO.
MMYOLO_PRETRAINED_WEIGHTS: dict[str, str] = {
    "yolov8_n_syncbn_fast_8xb16-500e_coco": (
        "https://download.openmmlab.com/mmyolo/v0/yolov8/yolov8_n_syncbn_fast_8xb16-500e_coco/"
        "yolov8_n_syncbn_fast_8xb16-500e_coco_20230114_131804-88c11cdb.pth"
    ),
    "yolov8_s_syncbn_fast_8xb16-500e_coco": (
        "https://download.openmmlab.com/mmyolo/v0/yolov8/yolov8_s_syncbn_fast_8xb16-500e_coco/"
        "yolov8_s_syncbn_fast_8xb16-500e_coco_20230117_180101-5aa5f0f1.pth"
    ),
    "yolov8_m_syncbn_fast_8xb16-500e_coco": (
        "https://download.openmmlab.com/mmyolo/v0/yolov8/yolov8_m_syncbn_fast_8xb16-500e_coco/"
        "yolov8_m_syncbn_fast_8xb16-500e_coco_20230115_192200-c22e560a.pth"
    ),
    "yolov8_l_syncbn_fast_8xb16-500e_coco": (
        "https://download.openmmlab.com/mmyolo/v0/yolov8/yolov8_l_syncbn_fast_8xb16-500e_coco/"
        "yolov8_l_syncbn_fast_8xb16-500e_coco_20230217_182526-189611b6.pth"
    ),
    "yolov8_x_syncbn_fast_8xb16-500e_coco": (
        "https://download.openmmlab.com/mmyolo/v0/yolov8/yolov8_x_syncbn_fast_8xb16-500e_coco/"
        "yolov8_x_syncbn_fast_8xb16-500e_coco_20230218_023338-5674673c.pth"
    ),
    "rtmdet_tiny_syncbn_fast_8xb32-300e_coco": (
        "https://download.openmmlab.com/mmyolo/v0/rtmdet/rtmdet_tiny_syncbn_fast_8xb32-300e_coco/"
        "rtmdet_tiny_syncbn_fast_8xb32-300e_coco_20230102_140117-dbb1dc83.pth"
    ),
    "rtmdet_s_syncbn_fast_8xb32-300e_coco": (
        "https://download.openmmlab.com/mmyolo/v0/rtmdet/rtmdet_s_syncbn_fast_8xb32-300e_coco/"
        "rtmdet_s_syncbn_fast_8xb32-300e_coco_20221230_182329-0a8c901a.pth"
    ),
    "rtmdet_m_syncbn_fast_8xb32-300e_coco": (
        "https://download.openmmlab.com/mmyolo/v0/rtmdet/rtmdet_m_syncbn_fast_8xb32-300e_coco/"
        "rtmdet_m_syncbn_fast_8xb32-300e_coco_20230102_135952-40af4fe8.pth"
    ),
    "rtmdet_l_syncbn_fast_8xb32-300e_coco": (
        "https://download.openmmlab.com/mmyolo/v0/rtmdet/rtmdet_l_syncbn_fast_8xb32-300e_coco/"
        "rtmdet_l_syncbn_fast_8xb32-300e_coco_20230102_135928-ee3abdc4.pth"
    ),
    "rtmdet_x_syncbn_fast_8xb32-300e_coco": (
        "https://download.openmmlab.com/mmyolo/v0/rtmdet/rtmdet_x_syncbn_fast_8xb32-300e_coco/"
        "rtmdet_x_syncbn_fast_8xb32-300e_coco_20221231_100345-b85cd476.pth"
    ),
}


def mmyolo_config_stem(config_id: str) -> str:
    """Config file stem from a config id or path."""
    cfg = (config_id or "").strip()
    if cfg.endswith(".py"):
        return Path(cfg).name.removesuffix(".py")
    return cfg.replace("\\", "/").split("/")[-1]


def mmyolo_pretrained_checkpoint(config_id: str) -> Optional[str]:
    """COCO pretrained checkpoint URL for a MMYOLO config stem, if known."""
    stem = mmyolo_config_stem(config_id)
    if stem in MMYOLO_PRETRAINED_WEIGHTS:
        return MMYOLO_PRETRAINED_WEIGHTS[stem]
    # rtmdet-ins / rtmdet-r configs vary; try common suffix pattern
    for key, url in MMYOLO_PRETRAINED_WEIGHTS.items():
        if stem.startswith(key.split("_syncbn")[0]):
            return url
    return None


def mmyolo_config_name(arch: str, size: str) -> str:
    """Resolve (arch, size) → MMYolo config identifier used with `mim run mmyolo train`."""
    if arch not in MMYOLO_VALID_ARCHS:
        raise ValueError(f"Unknown MMYOLO arch '{arch}'. Valid: {sorted(MMYOLO_VALID_ARCHS)}")
    if size not in MMYOLO_VALID_SIZES:
        raise ValueError(f"Unknown MMYOLO size '{size}'. Valid: {sorted(MMYOLO_VALID_SIZES)}")
    if arch == "yolov8":
        return f"yolov8_{size}_syncbn_fast_8xb16-500e_coco"
    return f"{arch}_{size}"
