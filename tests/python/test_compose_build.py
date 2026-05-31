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
    assert _is_local_build_tag("lai-celery:local") is True
    assert _is_local_build_tag("ghcr.io/org/repo-celery-worker:latest") is False


def test_image_tags_defaults(tmp_path: Path):
    tags = image_tags(tmp_path)
    assert tags["LAI_CELERY_IMAGE"] == "lai-celery:local"
    assert tags["LAI_MMYOLO_IMAGE"] == "lai-mmyolo:local"


def test_image_tags_from_env(tmp_path: Path):
    env = tmp_path / ".env"
    env.write_text("LAI_CELERY_IMAGE=ghcr.io/foo/celery:main\n")
    tags = image_tags(tmp_path)
    assert tags["LAI_CELERY_IMAGE"] == "ghcr.io/foo/celery:main"


def test_uses_local_build_with_defaults(tmp_path: Path):
    assert uses_local_build(tmp_path) is True


def test_uses_local_build_with_ghcr(tmp_path: Path):
    (tmp_path / ".env").write_text(
        "LAI_CELERY_IMAGE=ghcr.io/x/celery:latest\n"
        "LAI_BACKEND_IMAGE=ghcr.io/x/backend:latest\n"
    )
    assert uses_local_build(tmp_path) is False


def test_should_build_stack_force_respects_ghcr(tmp_path: Path):
    (tmp_path / ".env").write_text(
        "LAI_CELERY_IMAGE=ghcr.io/x/celery:latest\n"
        "LAI_BACKEND_IMAGE=ghcr.io/x/backend:latest\n"
    )
    assert should_build_stack(tmp_path, force=True) is False


def test_parse_env_file_ignores_comments(tmp_path: Path):
    env = tmp_path / ".env"
    env.write_text("# comment\nLAI_DATA_DIR=/data/lai\n")
    parsed = _parse_env_file(env)
    assert parsed["LAI_DATA_DIR"] == "/data/lai"
