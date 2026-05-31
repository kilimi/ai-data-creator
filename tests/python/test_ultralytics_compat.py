"""Tests for Ultralytics 8.4+ lazy export compatibility patch."""
from app.ml.ultralytics_compat import patch_ultralytics_lazy_exports


def test_patch_ultralytics_lazy_exports_idempotent():
    patch_ultralytics_lazy_exports()
    patch_ultralytics_lazy_exports()

    try:
        import ultralytics
    except Exception:
        return  # ultralytics not installed in this test env

    # After patch, direct import must work (required by ultralytics check_amp).
    from ultralytics import YOLO  # noqa: F401

    assert getattr(ultralytics, "YOLO", None) is not None
