"""Tests for on-disk evaluation payload storage."""
import gzip
import json
from app.evaluation_artifacts import (
    load_merged_evaluation_results,
    read_evaluation_blobs_relative,
    write_evaluation_blobs,
)


def test_write_read_roundtrip(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    rel = write_evaluation_blobs(1, 99, [{"k": 1}], [{"g": 2}], {"0_1": [{"x": 3}]})
    assert "projects/1/evaluations/task_99/blobs.json.gz" in rel.replace("\\", "/")
    assert (tmp_path / rel).is_file()
    data = read_evaluation_blobs_relative(rel)
    assert data["predictions"] == [{"k": 1}]
    assert data["all_ground_truth"] == [{"g": 2}]
    assert data["confusion_matrix_samples"] == {"0_1": [{"x": 3}]}


def test_load_merged_inline_legacy():
    results = {"precision": 0.5, "predictions": [{"a": 1}]}
    merged = load_merged_evaluation_results(results)
    assert merged["predictions"] == [{"a": 1}]
    assert merged["precision"] == 0.5


def test_load_merged_from_file(tmp_path):
    rel_path = tmp_path / "b.json.gz"
    payload = {
        "format_version": 1,
        "predictions": [{"image_id": 1}],
        "all_ground_truth": [],
        "confusion_matrix_samples": {},
    }
    with gzip.open(rel_path, "wt", encoding="utf-8") as f:
        json.dump(payload, f)
    results = {"precision": 0.9, "artifacts": {"blobs": str(rel_path)}}
    merged = load_merged_evaluation_results(results)
    assert merged["precision"] == 0.9
    assert len(merged["predictions"]) == 1
