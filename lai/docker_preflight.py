"""Check Docker / Compose before install (shared by terminal and GUI flows)."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def check_docker_stack(bundle_root: Path) -> list[str]:
    """Return human-readable errors (empty if OK)."""
    errs: list[str] = []

    if not shutil.which("docker"):
        errs.append(
            "Docker is not installed or not in PATH. Install Docker Engine: https://docs.docker.com/engine/install/"
        )
        return errs

    r = subprocess.run(["docker", "info"], capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        errs.append(
            "Docker is installed but not usable (is the daemon running?). Try: sudo systemctl start docker"
        )
        return errs

    r = subprocess.run(["docker", "compose", "version"], capture_output=True, text=True, timeout=15)
    if r.returncode != 0:
        errs.append(
            "Docker Compose v2 plugin missing. Install: https://docs.docker.com/compose/install/"
        )
        return errs

    short = subprocess.run(
        ["docker", "compose", "version", "--short"],
        capture_output=True,
        text=True,
        timeout=15,
    )
    ver = (short.stdout or "").strip().lstrip("v")
    if ver:
        parts = ver.split(".")
        try:
            major = int("".join(c for c in parts[0] if c.isdigit()) or "0")
            minor_part = parts[1] if len(parts) > 1 else "0"
            minor = int("".join(c for c in minor_part if c.isdigit()) or "0")
        except ValueError:
            major, minor = 0, 0
        if major < 2 or (major == 2 and minor < 24):
            errs.append(
                f"Docker Compose is too old (have {ver}, need >= 2.24 for compose 'include'). Upgrade Docker/Compose."
            )

    # Prefer plain `docker compose config` so .env COMPOSE_FILE (e.g. code-mount fragment) is honored.
    if (bundle_root / "docker-compose.yml").is_file():
        r = subprocess.run(
            ["docker", "compose", "config"],
            cwd=bundle_root,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if r.returncode != 0:
            err = (r.stderr or r.stdout or "").strip()[:500]
            errs.append(f"docker compose config failed: {err}")

    return errs
