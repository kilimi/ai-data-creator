#!/usr/bin/env python3
"""
Download all Ultralytics foundation models used by Auto-Annotate and Convert Model.
Run during Docker build so models are available offline.
Copies each model to /app/models/ so export and preannotate can load by path.
Uses same arch/size combinations as the frontend (ExportModelModal, AutoAnnotateModal).
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

MODELS_DIR = Path("/app/models")


def main() -> None:
    try:
        from ultralytics import YOLO
    except ImportError:
        print("ultralytics not installed, skipping model download", file=sys.stderr)
        return

    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    # Same arch/size matrix as frontend: YOLO_ARCHS + YOLO_SIZES
    arch_sizes: list[tuple[str, str]] = [
        ("yolo11", "n"), ("yolo11", "s"), ("yolo11", "m"), ("yolo11", "l"), ("yolo11", "x"),
        ("yolo26", "n"), ("yolo26", "s"), ("yolo26", "m"), ("yolo26", "l"), ("yolo26", "x"),
        ("yolo_nas", "s"), ("yolo_nas", "m"), ("yolo_nas", "l"),
        ("rtdetr", "l"), ("rtdetr", "x"),
    ]
    # Task types: detect (no suffix), segment (-seg), classify (-cls)
    suffixes = ["", "-seg", "-cls"]

    models_to_download: list[str] = []
    for arch, size in arch_sizes:
        base = f"{arch}{size}"
        for suf in suffixes:
            name = f"{base}{suf}.pt" if suf else f"{base}.pt"
            models_to_download.append(name)

    print(f"Downloading {len(models_to_download)} Ultralytics models to {MODELS_DIR}...")
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
            # Some combos may not exist (e.g. rtdetr-seg); skip
            print(f"  Skip {name}: {e}", file=sys.stderr)
    print("Done.")


if __name__ == "__main__":
    main()
