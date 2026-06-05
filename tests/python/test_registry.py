"""Tests for pull-only distribution registry helpers."""
from __future__ import annotations

from pathlib import Path

from lai.compose_build import uses_local_build
from lai.registry import (
    default_bundle_url,
    gpu_tier_enabled,
    is_developer_checkout,
    registry_image_tag,
    registry_image_tags,
)


def test_registry_image_tag_format():
    tag = registry_image_tag("LAI_BACKEND_IMAGE", "1.2.3")
    assert tag.startswith("ghcr.io/")
    assert tag.endswith("/lai-backend:1.2.3")


def test_registry_image_tags_all_keys():
    tags = registry_image_tags("0.1.0")
    assert "LAI_BACKEND_IMAGE" in tags
    assert "LAI_SAM_IMAGE" in tags
    assert all(":" in v for v in tags.values())


def test_default_bundle_url_uses_release_asset():
    url = default_bundle_url("1.0.0")
    assert "releases/download/v1.0.0/lai-dist-1.0.0.tar.gz" in url


def test_uses_local_build_only_configured_keys(tmp_path: Path):
    env = tmp_path / ".env"
    env.write_text(
        "LAI_BACKEND_IMAGE=ghcr.io/x/lai-backend:1.0.0\n"
        "LAI_WORKER_GPU_IMAGE=ghcr.io/x/lai-worker-gpu:1.0.0\n"
        "LAI_WORKER_GENERAL_IMAGE=ghcr.io/x/lai-worker-general:1.0.0\n"
        "LAI_FRONTEND_IMAGE=ghcr.io/x/lai-frontend:1.0.0\n"
        "LAI_SAM_IMAGE=ghcr.io/x/lai-sam:1.0.0\n"
        "LAI_ULTRALYTICS_IMAGE=ghcr.io/x/lai-ultralytics:1.0.0\n"
        "LAI_MMYOLO_IMAGE=ghcr.io/x/lai-mmyolo:1.0.0\n"
    )
    assert uses_local_build(tmp_path) is False


def test_gpu_tier_enabled_from_env():
    assert gpu_tier_enabled({"LAI_GPU_TIER": "1"}) is True
    assert gpu_tier_enabled({"COMPOSE_PROFILES": "gpu"}) is True
    assert gpu_tier_enabled({"LAI_GPU_TIER": "0"}) is False


def test_is_developer_checkout_with_repo_root(tmp_path: Path, monkeypatch):
    (tmp_path / "docker-compose.yml").write_text("include: []\n")
    monkeypatch.setattr("lai.paths._package_dir", lambda: tmp_path / "lai")
    (tmp_path / "lai").mkdir()
    assert is_developer_checkout(tmp_path) is True
