"""Tests for foundation model matrix and install-time spec resolution."""

from app.foundation_models import (
    ARCH_SIZES,
    DEPTH_ONNX_NAMES,
    MINIMAL_DEPTH_ONNX,
    MINIMAL_ULTRALYTICS_PT,
    pretrained_yolo_catalog,
    resolve_depth_models_spec,
    resolve_ultralytics_pretrained_spec,
    ultralytics_foundation_pt_names,
)


def test_arch_sizes_covers_auto_annotate_families():
    archs = {a for a, _ in ARCH_SIZES}
    assert archs >= {"yolo11", "yolo26", "yolo_nas", "rtdetr"}


def test_ultralytics_names_include_yolo_nas_and_rtdetr_variants():
    names = ultralytics_foundation_pt_names()
    assert "yolo_nass-seg.pt" in names
    assert "rtdetrl.pt" in names
    assert "yolo11n-seg.pt" in names


def test_resolve_all_equals_full_matrix():
    full = ultralytics_foundation_pt_names()
    assert resolve_ultralytics_pretrained_spec("all") == sorted(full)
    assert resolve_ultralytics_pretrained_spec("") == sorted(full)


def test_resolve_none_skips_baked_weights():
    assert resolve_ultralytics_pretrained_spec("none") == []
    assert resolve_ultralytics_pretrained_spec("on_demand") == []
    assert resolve_depth_models_spec("none") == []
    assert resolve_depth_models_spec("on_demand") == []


def test_resolve_minimal_subset():
    r = resolve_ultralytics_pretrained_spec("minimal")
    assert set(r) == set(MINIMAL_ULTRALYTICS_PT)
    assert len(r) == len(MINIMAL_ULTRALYTICS_PT)


def test_resolve_arch_token_yolo11():
    r = resolve_ultralytics_pretrained_spec("yolo11")
    assert all(n.startswith("yolo11") for n in r)
    assert "yolo26n.pt" not in r


def test_resolve_comma_archs():
    r = resolve_ultralytics_pretrained_spec("yolo_nas,rtdetr")
    assert all(n.startswith("yolo_nas") or n.startswith("rtdetr") for n in r)
    assert "yolo11n.pt" not in r


def test_unknown_arch_token_ignored():
    """Overly short tokens like 'yolo' must not match every architecture."""
    r = resolve_ultralytics_pretrained_spec("yolo")
    assert r == sorted(MINIMAL_ULTRALYTICS_PT)


def test_resolve_exact_pt_files():
    r = resolve_ultralytics_pretrained_spec("yolo11n.pt,yolo26m-seg.pt")
    assert r == ["yolo11n.pt", "yolo26m-seg.pt"]


def test_pretrained_catalog_matches_matrix():
    cat = pretrained_yolo_catalog()
    assert set(cat.keys()) == set(ultralytics_foundation_pt_names())
    assert cat["yolo11n-seg.pt"]["type"] == "segmentation"
    assert cat["yolo11n.pt"]["type"] == "detection"


def test_depth_spec_all_and_minimal():
    assert resolve_depth_models_spec("all") == list(DEPTH_ONNX_NAMES)
    assert resolve_depth_models_spec("minimal") == list(MINIMAL_DEPTH_ONNX)


def test_depth_spec_exact_files():
    one = "depth_anything_v2_vitb_outdoor_dynamic.onnx"
    assert resolve_depth_models_spec(one) == [one]