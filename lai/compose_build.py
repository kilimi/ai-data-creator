"""Ordered docker compose builds for the LAI stack (split workers, ML runtimes)."""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Iterable

# Image env vars checked for local (:local / :dev) vs registry pulls.
IMAGE_ENV_KEYS = (
    "LAI_BACKEND_IMAGE",
    "LAI_WORKER_GPU_IMAGE",
    "LAI_WORKER_GENERAL_IMAGE",
    "LAI_ULTRALYTICS_IMAGE",
    "LAI_MMYOLO_IMAGE",
    "LAI_FRONTEND_IMAGE",
    "LAI_SAM_IMAGE",
)

DEFAULT_TAGS: dict[str, str] = {
    "LAI_BACKEND_IMAGE": "lai-backend:local",
    "LAI_WORKER_GPU_IMAGE": "lai-worker-gpu:local",
    "LAI_WORKER_GENERAL_IMAGE": "lai-worker-general:local",
    "LAI_ULTRALYTICS_IMAGE": "lai-ultralytics:local",
    "LAI_MMYOLO_IMAGE": "lai-mmyolo:local",
    "LAI_FRONTEND_IMAGE": "lai-frontend:local",
    "LAI_SAM_IMAGE": "lai-sam:local",
}

# Legacy alias (pre-split-worker installs); still read from .env for compatibility.
_LEGACY_CELERY_KEY = "LAI_CELERY_IMAGE"
_LEGACY_CELERY_DEFAULT = "lai-celery:local"

# Services built in dependency order (see backend/Dockerfile, Dockerfile.worker-gpu).
_BUILD_PROFILE_SERVICES = ("ultralytics_runtime", "mmyolo_runtime")
_BUILD_SERVICES = (
    "backend",
    "worker-gpu",
    "worker-general",
    "web",
    "sam_service",
)


def _is_local_build_tag(tag: str) -> bool:
    """True when the tag indicates a local compose build (not a registry pull)."""
    tag = (tag or "").strip()
    if not tag:
        return True
    if tag.endswith(":local") or tag.endswith(":dev"):
        return True
    # No registry host → implicit local name (e.g. lai-backend:local).
    if "/" not in tag.split("@", 1)[0]:
        return True
    return False


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        key, _, val = s.partition("=")
        out[key.strip()] = val.strip().strip('"').strip("'")
    return out


def image_tags(root: Path) -> dict[str, str]:
    """Resolved image tags from .env with compose defaults."""
    env = _parse_env_file(root / ".env")
    tags = dict(DEFAULT_TAGS)
    legacy = env.get(_LEGACY_CELERY_KEY, "").strip()
    if legacy:
        tags[_LEGACY_CELERY_KEY] = legacy
        # Old .env files only set LAI_CELERY_IMAGE — treat as GPU worker image.
        if "LAI_WORKER_GPU_IMAGE" not in env:
            tags["LAI_WORKER_GPU_IMAGE"] = legacy
    for key in IMAGE_ENV_KEYS:
        if key in env and env[key].strip():
            tags[key] = env[key].strip()
    # Expose legacy key for tests / old tooling.
    tags.setdefault(_LEGACY_CELERY_KEY, tags.get("LAI_WORKER_GPU_IMAGE", _LEGACY_CELERY_DEFAULT))
    return tags


def uses_local_build(root: Path) -> bool:
    """True when any stack image is configured for local build."""
    tags = image_tags(root)
    keys = list(IMAGE_ENV_KEYS) + [_LEGACY_CELERY_KEY]
    return any(_is_local_build_tag(tags.get(k, "")) for k in keys)


def _image_exists(tag: str) -> bool:
    if not tag:
        return False
    proc = subprocess.run(
        ["docker", "image", "inspect", tag],
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def missing_runtime_images(root: Path) -> list[str]:
    """Tags for local ML/runtime images that are not present on the host."""
    tags = image_tags(root)
    if not uses_local_build(root):
        return []
    missing: list[str] = []
    for key in (
        "LAI_ULTRALYTICS_IMAGE",
        "LAI_MMYOLO_IMAGE",
        "LAI_BACKEND_IMAGE",
        "LAI_WORKER_GPU_IMAGE",
        "LAI_WORKER_GENERAL_IMAGE",
    ):
        tag = tags.get(key, "")
        if _is_local_build_tag(tag) and not _image_exists(tag):
            missing.append(tag)
    return missing


def should_build_stack(root: Path, *, force: bool = False) -> bool:
    """Whether lai up should run an ordered build before starting."""
    if force:
        return uses_local_build(root)
    return bool(missing_runtime_images(root))


def _compose_cmd(root: Path, *args: str) -> list[str]:
    return ["docker", "compose", *args]


def _run_build(root: Path, services: Iterable[str], *, no_cache: bool) -> int:
    cmd = _compose_cmd(root, "build", *services)
    if no_cache:
        cmd.append("--no-cache")
    print(f"+ cd {root} && {' '.join(cmd)}", flush=True)
    return subprocess.run(cmd, cwd=root).returncode


def build_stack(root: Path, *, no_cache: bool = False) -> int:
    """
    Build images in dependency order.

    ML runtime images (profile ``build``) must exist before ``backend`` copies MMYOLO.
    GPU/CPU workers are separate services (not ``celery_worker``).
    """
    if not uses_local_build(root):
        print("Using registry images from .env; skipping local build.", flush=True)
        return 0

    rc = _run_build(root, _BUILD_PROFILE_SERVICES, no_cache=no_cache)
    if rc != 0:
        return rc

    for service in _BUILD_SERVICES:
        rc = _run_build(root, (service,), no_cache=no_cache)
        if rc != 0:
            return rc
    return 0
