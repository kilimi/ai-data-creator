"""Tests for generated MMYOLO config content."""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

_spec = importlib.util.spec_from_file_location(
    "mmyolo_config_test", BACKEND_DIR / "app/tasks/mmyolo_config.py"
)
_mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]
MMYOLOConfigParams = _mod.MMYOLOConfigParams
build_mmyolo_config_content = _mod.build_mmyolo_config_content


def _sample_params(**overrides) -> MMYOLOConfigParams:
    base = dict(
        base_cfg="yolov8_s_syncbn_fast_8xb16-500e_coco.py",
        num_classes=2,
        class_names_py="('a', 'b')",
        epochs=30,
        batch_size=16,
        image_size=640,
        work_dir="/tmp/work",
        train_json_abs="/tmp/train.json",
        val_json_abs="/tmp/val.json",
        train_images_abs="/tmp/images/train",
        val_images_abs="/tmp/images/val",
        is_dji_mode=True,
        dji_use_widen_factor_025=False,
    )
    base.update(overrides)
    return MMYOLOConfigParams(**base)


def test_generated_config_avoids_albumentations_pipeline_switch():
    content = build_mmyolo_config_content(_sample_params())
    assert "type='mmdet.PipelineSwitchHook'" not in content
    assert "train_pipeline_stage2 = list(_pad_resize_pipeline)" in content
    assert "type='mmdet.Albu'" not in content
    assert "train_cfg = dict(" in content
    assert "max_epochs=max_epochs" in content
    assert "meta_keys=('img_id', 'img_path'" in content


def test_generated_config_sets_coco_pretrained_load_from():
    content = build_mmyolo_config_content(
        _sample_params(
            base_cfg="yolov8_s_syncbn_fast_8xb16-500e_coco.py",
            is_dji_mode=False,
        )
    )
    assert "load_from = 'https://download.openmmlab.com/mmyolo/v0/yolov8/" in content
