from __future__ import annotations

import os
from pathlib import Path


def _package_dir() -> Path:
    return Path(__file__).resolve().parent


def _candidate_repo_root() -> Path | None:
    """If lai/ lives at <repo>/lai/, return <repo> when docker-compose.yml is there."""
    pkg = _package_dir()
    guess = pkg.parent
    if (guess / "docker-compose.yml").is_file():
        return guess
    return None


def bundle_data_dir() -> Path:
    base = os.environ.get("XDG_DATA_HOME", "").strip()
    if base:
        return Path(base) / "lai" / "app"
    return Path.home() / ".local" / "share" / "lai" / "app"


def get_bundle_root(*, force_download: bool = False) -> Path:
    """
    Directory that contains docker-compose.yml and backend/.

    - Editable / from-source install: repository root next to this package.
    - PyPI wheel: cached copy under ~/.local/share/lai/app (or XDG_DATA_HOME).
    """
    local = _candidate_repo_root()
    if local is not None and not force_download:
        return local

    return _ensure_cached_bundle(force=force_download)


def _ensure_cached_bundle(*, force: bool) -> Path:
    from lai.bundle import ensure_bundle

    return ensure_bundle(force=force)
