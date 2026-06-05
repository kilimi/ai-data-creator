"""Tests for ordered compose build helpers."""
from __future__ import annotations

from pathlib import Path

from lai.compose_build import (
    _is_local_build_tag,
    _parse_env_file,
    image_tags,
    should_build_stack,
    uses_local_build,
)


def test_is_local_build_tag():
    assert _is_local_build_tag("lai-worker-gpu:local") is True
    assert _is_local_build_tag("ghcr.io/org/repo-worker-gpu:latest") is False


def test_image_tags_defaults(tmp_path: Path):
    tags = image_tags(tmp_path)
    assert tags["LAI_WORKER_GPU_IMAGE"] == "lai-worker-gpu:local"
    assert tags["LAI_MMYOLO_IMAGE"] == "lai-mmyolo:local"
    # Legacy alias for old .env keys
    assert tags["LAI_CELERY_IMAGE"] == "lai-worker-gpu:local"


def test_image_tags_from_env(tmp_path: Path):
    env = tmp_path / ".env"
    env.write_text("LAI_WORKER_GPU_IMAGE=ghcr.io/foo/worker-gpu:main\n")
    tags = image_tags(tmp_path)
    assert tags["LAI_WORKER_GPU_IMAGE"] == "ghcr.io/foo/worker-gpu:main"


def test_image_tags_legacy_celery_env_maps_to_gpu_worker(tmp_path: Path):
    env = tmp_path / ".env"
    env.write_text("LAI_CELERY_IMAGE=ghcr.io/foo/celery:main\n")
    tags = image_tags(tmp_path)
    assert tags["LAI_CELERY_IMAGE"] == "ghcr.io/foo/celery:main"
    assert tags["LAI_WORKER_GPU_IMAGE"] == "ghcr.io/foo/celery:main"


def test_uses_local_build_with_defaults(tmp_path: Path):
    assert uses_local_build(tmp_path) is True


def _ghcr_env() -> str:
    return "\n".join(
        [
            "LAI_BACKEND_IMAGE=ghcr.io/x/backend:latest",
            "LAI_WORKER_GPU_IMAGE=ghcr.io/x/worker-gpu:latest",
            "LAI_WORKER_GENERAL_IMAGE=ghcr.io/x/worker-general:latest",
            "LAI_ULTRALYTICS_IMAGE=ghcr.io/x/ultralytics:latest",
            "LAI_MMYOLO_IMAGE=ghcr.io/x/mmyolo:latest",
            "LAI_FRONTEND_IMAGE=ghcr.io/x/frontend:latest",
            "LAI_SAM_IMAGE=ghcr.io/x/sam:latest",
        ]
    )


def test_uses_local_build_with_ghcr(tmp_path: Path):
    (tmp_path / ".env").write_text(_ghcr_env())
    assert uses_local_build(tmp_path) is False


def test_should_build_stack_force_respects_ghcr(tmp_path: Path):
    (tmp_path / ".env").write_text(_ghcr_env())
    assert should_build_stack(tmp_path, force=True) is False


def test_parse_env_file_ignores_comments(tmp_path: Path):
    env = tmp_path / ".env"
    env.write_text("# comment\nLAI_DATA_DIR=/data/lai\n")
    parsed = _parse_env_file(env)
    assert parsed["LAI_DATA_DIR"] == "/data/lai"
