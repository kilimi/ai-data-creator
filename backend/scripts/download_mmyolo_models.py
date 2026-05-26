#!/usr/bin/env python3
"""
Download MMYOLO checkpoints/config assets for offline-first training.

Selection is controlled by LAI_MMYOLO_MODELS:
    - minimal (default): rtmdet_s, rtmdet-ins_s, rtmdet-r_s
  - all: all supported arch/size combinations used by training UI
  - none: skip
  - comma list: e.g. rtmdet_s,rtmdet-ins_m

Artifacts are downloaded via `python -m mim download <package> --config <name>`
into /app/models/mmyolo.

Notes:
    - rtmdet* and rtmdet-r* weights are in mmyolo package index.
    - rtmdet-ins* weights are in mmdet package index.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

DEST_DIR = Path("/app/models/mmyolo")
MMYOLO_PYTHON = os.environ.get('MMYOLO_PYTHON', '/opt/mmyolo-venv/bin/python')
if not Path(MMYOLO_PYTHON).exists():
    MMYOLO_PYTHON = sys.executable

# UI-facing aliases -> (mim package, official config id)
ALIAS_TO_TARGET = {
    "rtmdet_tiny": ("mmyolo", "rtmdet_tiny_syncbn_fast_8xb32-300e_coco"),
    "rtmdet_s": ("mmyolo", "rtmdet_s_syncbn_fast_8xb32-300e_coco"),
    "rtmdet_m": ("mmyolo", "rtmdet_m_syncbn_fast_8xb32-300e_coco"),
    "rtmdet_l": ("mmyolo", "rtmdet_l_syncbn_fast_8xb32-300e_coco"),
    "rtmdet_x": ("mmyolo", "rtmdet_x_syncbn_fast_8xb32-300e_coco"),

    # RTMDet-Ins lives in MMDetection model zoo.
    "rtmdet-ins_tiny": ("mmdet", "rtmdet-ins_tiny_8xb32-300e_coco"),
    "rtmdet-ins_s": ("mmdet", "rtmdet-ins_s_8xb32-300e_coco"),
    "rtmdet-ins_m": ("mmdet", "rtmdet-ins_m_8xb32-300e_coco"),
    "rtmdet-ins_l": ("mmdet", "rtmdet-ins_l_8xb32-300e_coco"),
    "rtmdet-ins_x": ("mmdet", "rtmdet-ins_x_8xb16-300e_coco"),

    "rtmdet-r_tiny": ("mmyolo", "rtmdet-r_tiny_fast_1xb8-36e_dota"),
    "rtmdet-r_s": ("mmyolo", "rtmdet-r_s_fast_1xb8-36e_dota"),
    "rtmdet-r_m": ("mmyolo", "rtmdet-r_m_syncbn_fast_2xb4-36e_dota"),
    "rtmdet-r_l": ("mmyolo", "rtmdet-r_l_syncbn_fast_2xb4-36e_dota"),
}

ALL_ALIASES = list(ALIAS_TO_TARGET.keys())
MINIMAL_ALIASES = ["rtmdet_s", "rtmdet-ins_s", "rtmdet-r_s"]


def resolve_spec(spec: str) -> list[str]:
    raw = (spec or "minimal").strip().lower()
    if raw == "none":
        return []
    if raw == "minimal":
        return MINIMAL_ALIASES
    if raw == "all":
        return ALL_ALIASES
    return [item.strip() for item in spec.split(",") if item.strip()]


def run_download(alias: str) -> bool:
    target = ALIAS_TO_TARGET.get(alias)
    if not target:
        print(f"  Skip {alias}: unknown alias", file=sys.stderr)
        return False

    package, config_name = target
    cmd = [
        MMYOLO_PYTHON,
        "-m",
        "mim",
        "download",
        package,
        "--config",
        config_name,
        "--dest",
        str(DEST_DIR),
    ]
    env = {**os.environ}
    env.pop("PYTHONPATH", None)
    try:
        subprocess.run(cmd, check=True, env=env)
        return True
    except subprocess.CalledProcessError as exc:
        print(
            f"  Skip {alias} ({package}:{config_name}): mim exited with {exc.returncode}",
            file=sys.stderr,
        )
        return False


def main() -> int:
    spec = os.environ.get("LAI_MMYOLO_MODELS", "minimal")
    aliases = resolve_spec(spec)

    DEST_DIR.mkdir(parents=True, exist_ok=True)

    if not aliases:
        print(f"LAI_MMYOLO_MODELS={spec!r} -> nothing to download")
        return 0

    # Fail early if mim is unavailable.
    probe_env = {**os.environ}
    probe_env.pop("PYTHONPATH", None)
    probe = subprocess.run([MMYOLO_PYTHON, "-m", "mim", "--help"], capture_output=True, env=probe_env)
    if probe.returncode != 0:
        print("mim is not available in this environment. Install openmim/mmyolo first.", file=sys.stderr)
        return 1

    print(f"LAI_MMYOLO_MODELS={spec!r} -> {len(aliases)} model alias(es) -> {DEST_DIR}")
    ok = 0
    for idx, alias in enumerate(aliases, 1):
        print(f"[{idx}/{len(aliases)}] Downloading {alias} ...", flush=True)
        if run_download(alias):
            ok += 1

    print(f"Done. Successful: {ok}/{len(aliases)}")
    return 0 if ok > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
