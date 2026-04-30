#!/usr/bin/env python3
"""
Download Ultralytics foundation models for Auto-Annotate / export (offline use).

Subset is controlled by LAI_PRETRAINED_MODELS (see app.foundation_models.resolve_ultralytics_pretrained_spec).
Default: all models in the matrix. Run during Docker build.
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

# Allow imports when run as script before app is on path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.foundation_models import resolve_ultralytics_pretrained_spec

MODELS_DIR = Path("/app/models")


def main() -> None:
    spec = os.environ.get("LAI_PRETRAINED_MODELS", "all")
    models_to_download = resolve_ultralytics_pretrained_spec(spec)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    if not models_to_download:
        print(
            f"LAI_PRETRAINED_MODELS={spec!r} → bake no .pt into image. "
            "Weights download on demand when you train or auto-annotate (needs network).",
            flush=True,
        )
        return

    try:
        from ultralytics import YOLO
    except ImportError:
        print("ultralytics not installed, skipping model download", file=sys.stderr)
        return

    print(f"LAI_PRETRAINED_MODELS={spec!r} → {len(models_to_download)} model(s) → {MODELS_DIR}")
    for i, name in enumerate(models_to_download, 1):
        try:
            print(f"[{i}/{len(models_to_download)}] Loading {name} ...", flush=True)
            model = YOLO(name)
            src = getattr(model, "pt_path", None) or getattr(model, "path", None) or getattr(model, "ckpt_path", None)
            if src is not None:
                src = Path(src)
                if src.exists():
                    dst = MODELS_DIR / name
                    if dst.resolve() != src.resolve():
                        shutil.copy2(str(src), str(dst))
                        print(f"  Copied to {dst}")
                    else:
                        print(f"  OK (already in {MODELS_DIR})")
                else:
                    print(f"  OK {name}")
            else:
                print(f"  OK {name}")
        except Exception as e:
            print(f"  Skip {name}: {e}", file=sys.stderr)
    print("Done.")


if __name__ == "__main__":
    main()
