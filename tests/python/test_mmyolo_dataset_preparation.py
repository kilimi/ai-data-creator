"""
TDD tests for MMYOLO COCO-format dataset preparation.

prepare_mmyolo_dataset() converts DB annotation objects into COCO JSON files
that MMYolo/RTMDet consumes — this is different from the YOLO .txt format.

All tests use in-memory fakes; no real DB, no filesystem writes (except tmp).
"""
import json
import pytest
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


from app.ml.dataset import prepare_mmyolo_dataset


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_image(id, file_name, width=640, height=480, dataset_id=1, url=None):
    img = MagicMock()
    img.id = id
    img.file_name = file_name
    img.width = width
    img.height = height
    img.dataset_id = dataset_id
    img.url = url or f"/static/projects/{dataset_id}/images/{file_name}"
    img.collection = None
    return img


def _make_annotation(id, image_id, category_id, annotation_file_id,
                     bbox=None, segmentation=None,
                     bbox_x=None, bbox_y=None, bbox_width=None, bbox_height=None):
    ann = MagicMock()
    ann.id = id
    ann.image_id = image_id
    ann.category_id = category_id
    ann.annotation_file_id = annotation_file_id
    ann.bbox = bbox
    ann.segmentation = segmentation
    ann.bbox_x = bbox_x
    ann.bbox_y = bbox_y
    ann.bbox_width = bbox_width
    ann.bbox_height = bbox_height
    return ann


def _make_class(id, class_name, category_id, annotation_file_id):
    cls = MagicMock()
    cls.id = id
    cls.class_name = class_name
    cls.category_id = category_id
    cls.annotation_file_id = annotation_file_id
    return cls


def _make_db(images, annotations, classes, annotation_file_id):
    """Build a minimal mock DB that responds to the queries prepare_mmyolo_dataset makes."""
    db = MagicMock()

    def query_side_effect(model_class):
        from app.models import Image, Annotation, AnnotationClass, Dataset, AnnotationFile, ImageCollection

        mock_q = MagicMock()

        if model_class is Dataset:
            ds = MagicMock()
            ds.id = 1
            ds.name = "Test Dataset"
            mock_q.filter.return_value.first.return_value = ds

        elif model_class is Image:
            mock_q.filter.return_value.all.return_value = images
            mock_q.filter.return_value.join.return_value.filter.return_value.all.return_value = images

        elif model_class is Annotation:
            def _ann_filter(*args, **kwargs):
                inner = MagicMock()
                inner.all.return_value = annotations
                return inner
            mock_q.filter.side_effect = _ann_filter

        elif model_class is AnnotationClass:
            def _cls_filter(*args, **kwargs):
                inner = MagicMock()
                inner.all.return_value = classes
                # For per-annotation class lookup by category_id
                matched = [c for c in classes if True]  # return all; tests will check
                inner.first.return_value = matched[0] if matched else None
                return inner
            mock_q.filter.side_effect = _cls_filter

        elif model_class is AnnotationFile:
            af = MagicMock()
            af.id = annotation_file_id
            mock_q.filter.return_value.first.return_value = af

        return mock_q

    db.query.side_effect = query_side_effect
    return db


# ── Detection (bbox) ─────────────────────────────────────────────────────────

class TestPrepareMMYOLODatasetDetect:
    def test_produces_coco_json_with_categories(self, tmp_path):
        images = [_make_image(1, "img1.jpg")]
        classes = [_make_class(1, "cat", category_id=0, annotation_file_id=10)]
        annotations = [_make_annotation(1, image_id=1, category_id=0,
                                        annotation_file_id=10,
                                        bbox=[10, 20, 100, 80])]
        db = _make_db(images, annotations, classes, annotation_file_id=10)

        dataset_configs = [{
            "dataset_id": 1,
            "annotation_file_id": 10,
            "split": {"train": 100, "val": 0, "test": 0},
        }]

        result = prepare_mmyolo_dataset(db, dataset_configs, tmp_path, task="detect")

        assert "train_json" in result
        train_json_path = Path(result["train_json"])
        assert train_json_path.exists()

        data = json.loads(train_json_path.read_text())
        assert "categories" in data
        assert "images" in data
        assert "annotations" in data
        assert any(c["name"] == "cat" for c in data["categories"])

    def test_bbox_written_as_xywh(self, tmp_path):
        images = [_make_image(1, "img1.jpg", width=640, height=480)]
        classes = [_make_class(1, "dog", category_id=0, annotation_file_id=10)]
        annotations = [_make_annotation(1, image_id=1, category_id=0,
                                        annotation_file_id=10,
                                        bbox=[50, 60, 200, 150])]
        db = _make_db(images, annotations, classes, annotation_file_id=10)

        dataset_configs = [{
            "dataset_id": 1,
            "annotation_file_id": 10,
            "split": {"train": 100, "val": 0, "test": 0},
        }]

        result = prepare_mmyolo_dataset(db, dataset_configs, tmp_path, task="detect")

        data = json.loads(Path(result["train_json"]).read_text())
        assert len(data["annotations"]) == 1
        ann = data["annotations"][0]
        # COCO bbox: [x, y, width, height] — stored as-is from DB
        assert ann["bbox"] == [50, 60, 200, 150]

    def test_eighty_twenty_split_includes_all_images(self, tmp_path):
        """12 images at 80/20 must not drop the 12th (regression: was 9+2 only)."""
        images = [_make_image(i, f"img{i}.jpg") for i in range(1, 13)]
        classes = [_make_class(1, "car", category_id=0, annotation_file_id=10)]
        annotations = [
            _make_annotation(i, image_id=i, category_id=0, annotation_file_id=10, bbox=[0, 0, 10, 10])
            for i in range(1, 13)
        ]
        db = _make_db(images, annotations, classes, annotation_file_id=10)
        dataset_configs = [{
            "dataset_id": 1,
            "annotation_file_id": 10,
            "split": {"train": 80, "val": 20, "test": 0},
        }]

        with patch("app.ml.dataset.formats.coco.os.link", side_effect=OSError), patch(
            "app.ml.dataset.formats.coco.shutil.copy2"
        ):
            result = prepare_mmyolo_dataset(db, dataset_configs, tmp_path, task="detect")

        train_data = json.loads(Path(result["train_json"]).read_text())
        val_data = json.loads(Path(result["val_json"]).read_text())
        assert len(train_data["images"]) == 10
        assert len(val_data["images"]) == 2
        assert len(train_data["annotations"]) + len(val_data["annotations"]) == 12

    def test_class_count_in_result(self, tmp_path):
        images = [_make_image(1, "img1.jpg")]
        classes = [
            _make_class(1, "car", category_id=0, annotation_file_id=10),
            _make_class(2, "truck", category_id=1, annotation_file_id=10),
        ]
        anns = [
            _make_annotation(1, 1, 0, 10, bbox=[0, 0, 100, 100]),
            _make_annotation(2, 1, 1, 10, bbox=[100, 0, 100, 100]),
        ]
        db = _make_db(images, anns, classes, annotation_file_id=10)

        dataset_configs = [{
            "dataset_id": 1,
            "annotation_file_id": 10,
            "split": {"train": 100, "val": 0, "test": 0},
        }]

        result = prepare_mmyolo_dataset(db, dataset_configs, tmp_path, task="detect")
        assert result["class_count"] == 2
        assert set(result["class_names"]) == {"car", "truck"}


# ── Segmentation (polygon) ───────────────────────────────────────────────────

class TestPrepareMMYOLODatasetSegment:
    def test_segmentation_annotation_written(self, tmp_path):
        images = [_make_image(1, "img1.jpg", width=640, height=480)]
        classes = [_make_class(1, "person", category_id=0, annotation_file_id=10)]
        polygon = [10.0, 10.0, 50.0, 10.0, 50.0, 50.0, 10.0, 50.0]
        annotations = [_make_annotation(
            1, image_id=1, category_id=0, annotation_file_id=10,
            bbox=[10, 10, 40, 40], segmentation=[polygon],
        )]
        db = _make_db(images, annotations, classes, annotation_file_id=10)

        dataset_configs = [{
            "dataset_id": 1,
            "annotation_file_id": 10,
            "split": {"train": 100, "val": 0, "test": 0},
        }]

        result = prepare_mmyolo_dataset(db, dataset_configs, tmp_path, task="segment")

        data = json.loads(Path(result["train_json"]).read_text())
        ann = data["annotations"][0]
        assert "segmentation" in ann
        assert ann["segmentation"] != []

    def test_segment_task_requires_segmentation_data(self, tmp_path):
        """Dataset with only bbox annotations should raise for segment task."""
        images = [_make_image(1, "img1.jpg")]
        classes = [_make_class(1, "thing", category_id=0, annotation_file_id=10)]
        # No segmentation data — only bbox
        annotations = [_make_annotation(1, 1, 0, 10, bbox=[0, 0, 100, 100], segmentation=None)]
        db = _make_db(images, annotations, classes, annotation_file_id=10)

        dataset_configs = [{
            "dataset_id": 1,
            "annotation_file_id": 10,
            "split": {"train": 100, "val": 0, "test": 0},
        }]

        with pytest.raises(ValueError, match="segmentation"):
            prepare_mmyolo_dataset(db, dataset_configs, tmp_path, task="segment")


# ── Oriented bounding boxes ──────────────────────────────────────────────────

class TestPrepareMMYOLODatasetOriented:
    def test_oriented_task_needs_segmentation_polygon_as_obb(self, tmp_path):
        """
        For oriented task, segmentation polygon (4-point) is used as the OBB.
        The output annotation must include a 'segmentation' key with 8 coords.
        """
        images = [_make_image(1, "img1.jpg", width=800, height=600)]
        classes = [_make_class(1, "plane", category_id=0, annotation_file_id=10)]
        # 4-point polygon (8 coords) representing an oriented box
        obb_polygon = [100.0, 50.0, 200.0, 60.0, 195.0, 120.0, 95.0, 110.0]
        annotations = [_make_annotation(
            1, image_id=1, category_id=0, annotation_file_id=10,
            bbox=[95, 50, 105, 70], segmentation=[obb_polygon],
        )]
        db = _make_db(images, annotations, classes, annotation_file_id=10)

        dataset_configs = [{
            "dataset_id": 1,
            "annotation_file_id": 10,
            "split": {"train": 100, "val": 0, "test": 0},
        }]

        result = prepare_mmyolo_dataset(db, dataset_configs, tmp_path, task="oriented")
        data = json.loads(Path(result["train_json"]).read_text())
        ann = data["annotations"][0]
        assert "segmentation" in ann
        # 8 coordinates for a 4-point oriented box
        assert len(ann["segmentation"][0]) == 8


# ── Train/val split ──────────────────────────────────────────────────────────

class TestPrepareMMYOLODatasetSplit:
    def test_val_json_created_when_split_nonzero(self, tmp_path):
        images = [_make_image(i, f"img{i}.jpg") for i in range(1, 6)]  # 5 images
        classes = [_make_class(1, "obj", category_id=0, annotation_file_id=10)]
        annotations = [_make_annotation(i, i, 0, 10, bbox=[0, 0, 10, 10]) for i in range(1, 6)]
        db = _make_db(images, annotations, classes, annotation_file_id=10)

        dataset_configs = [{
            "dataset_id": 1,
            "annotation_file_id": 10,
            "split": {"train": 80, "val": 20, "test": 0},
        }]

        result = prepare_mmyolo_dataset(db, dataset_configs, tmp_path, task="detect")

        assert "val_json" in result
        val_path = Path(result["val_json"])
        assert val_path.exists()

    def test_empty_dataset_raises(self, tmp_path):
        db = _make_db(images=[], annotations=[], classes=[], annotation_file_id=10)
        dataset_configs = [{
            "dataset_id": 1,
            "annotation_file_id": 10,
            "split": {"train": 80, "val": 20, "test": 0},
        }]

        with pytest.raises(ValueError):
            prepare_mmyolo_dataset(db, dataset_configs, tmp_path, task="detect")
