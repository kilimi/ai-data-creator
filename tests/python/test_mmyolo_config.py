"""Tests for generated MMYOLO config content."""
from app.tasks.mmyolo_config import MMYOLOConfigParams, build_mmyolo_config_content


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
