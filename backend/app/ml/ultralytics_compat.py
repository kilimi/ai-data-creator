"""Compatibility shims for Ultralytics 8.4.11+ lazy model exports."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_PATCHED = False


def patch_ultralytics_lazy_exports() -> None:
    """
    Ultralytics 8.4.11+ exposes YOLO/RTDETR via __getattr__ only.

    That breaks `from ultralytics import YOLO` used inside ultralytics itself
    (e.g. check_amp during training). Eagerly attach model classes to the package.
    """
    global _PATCHED
    if _PATCHED:
        return
    try:
        import ultralytics
    except Exception as exc:
        logger.debug("ultralytics not available for compat patch: %s", exc)
        return

    exports = (
        ("YOLO", "ultralytics.models.yolo.model", "YOLO"),
        ("RTDETR", "ultralytics.models", "RTDETR"),
    )
    for attr, module_path, class_name in exports:
        if getattr(ultralytics, attr, None) is not None:
            continue
        try:
            mod = __import__(module_path, fromlist=[class_name])
            cls = getattr(mod, class_name)
            setattr(ultralytics, attr, cls)
        except Exception as exc:
            logger.debug("Could not patch ultralytics.%s: %s", attr, exc)

    _PATCHED = True
