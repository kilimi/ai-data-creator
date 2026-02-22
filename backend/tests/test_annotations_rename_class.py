"""
Backend regression test: updating annotation content (e.g. renaming a class) must not wipe annotations.

The primary e2e test for this flow is Playwright: tests/e2e/annotations/rename-class-annotation.spec.ts
(rename class via class icon and dialog in the Dataset annotations view).

This pytest reproduces the same backend path (PUT update_annotation_content) and asserts
annotations are preserved after a "rename" payload. Requires a running DB.
"""
import io
import json
import time
import pytest

try:
    from fastapi.testclient import TestClient
except ImportError:
    pytest.skip("fastapi not installed", allow_module_level=True)

# Minimal 1x1 PNG (binary)
MINIMAL_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00"
    b"\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _create_app():
    import sys
    from pathlib import Path
    backend = Path(__file__).resolve().parent.parent
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))
    from app.main import app
    return app


@pytest.fixture
def client():
    return TestClient(_create_app())


def _minimal_coco(file_name: str, category_name: str = "OldClass"):
    """Minimal COCO payload: one image, one category, one annotation."""
    return {
        "info": {"description": "test", "version": "1.0"},
        "images": [{"id": 1, "file_name": file_name, "width": 100, "height": 100}],
        "categories": [{"id": 1, "name": category_name, "supercategory": ""}],
        "annotations": [
            {
                "id": 1,
                "image_id": 1,
                "category_id": 1,
                "bbox": [10, 10, 50, 50],
                "area": 2500,
                "iscrowd": 0,
                "segmentation": [],
            }
        ],
    }


def test_update_annotation_content_rename_class_preserves_annotations(client: TestClient):
    """
    Create dataset + image + annotation file, then update content with renamed category.
    Assert that after PUT update_annotation_content, annotations are still present and
    the new class name is reflected (no backend break / wipe).
    """
    # 1. Create project
    r = client.post(
        "/projects/",
        data={"name": "Test Rename Class", "description": ""},
    )
    assert r.status_code == 200, r.text
    project_id = r.json()["data"]["id"]

    # 2. Create dataset
    r = client.post(
        "/datasets/",
        data={"name": "DS Rename", "description": "", "project_id": str(project_id)},
    )
    assert r.status_code == 200, r.text
    dataset_id = r.json()["id"]

    # 3. Upload one image so the dataset has a matching image for COCO
    file_name = "test_rename_img.png"
    r = client.post(
        f"/datasets/{dataset_id}/images",
        files={"files": (file_name, io.BytesIO(MINIMAL_PNG), "image/png")},
    )
    assert r.status_code == 200, r.text

    # 4. Import annotations (creates annotation file and runs process_coco in background)
    coco_initial = _minimal_coco(file_name, "OldClass")
    r = client.post(
        f"/datasets/{dataset_id}/import-annotations",
        files={"file": ("ann.json", json.dumps(coco_initial).encode(), "application/json")},
    )
    assert r.status_code == 200, r.text
    file_id = r.json()["data"]["file_id"]

    # Wait for background processing
    time.sleep(2)

    # 5. Update content with renamed class (simulates "Save changes" after renaming class)
    coco_renamed = _minimal_coco(file_name, "NewClass")
    r = client.put(
        f"/datasets/{dataset_id}/annotations/{file_id}/content",
        files={"file": ("ann.json", json.dumps(coco_renamed).encode(), "application/json")},
    )
    assert r.status_code == 200, f"PUT should succeed: {r.text}"

    # 6. Get content and assert annotations were not wiped and class was renamed
    r = client.get(
        f"/datasets/{dataset_id}/annotations/{file_id}/content",
        params={"include_images": True, "include_annotations": True},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("success") is True
    content = data.get("data", {}).get("content")
    assert content is not None, "content should be returned"
    categories = content.get("categories", [])
    annotations = content.get("annotations", [])
    assert len(annotations) == 1, "annotations must not be wiped after rename"
    assert any(c.get("name") == "NewClass" for c in categories), "category should be renamed to NewClass"
