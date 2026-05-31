#!/usr/bin/env python3
"""Run Ultralytics YOLO / RT-DETR training in the isolated ultralytics venv."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, help="JSON file with model_class, model_path, train_args")
    args = parser.parse_args()

    from app.ml.ultralytics_compat import patch_ultralytics_lazy_exports

    patch_ultralytics_lazy_exports()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    model_class = cfg.get("model_class", "yolo")
    model_path = cfg["model_path"]
    train_args = cfg["train_args"]

    from app.ml.ultralytics_train_metrics import emit_trainer_epoch_metrics

    if model_class == "rtdetr":
        from ultralytics import RTDETR

        model = RTDETR(model_path)
    else:
        from ultralytics import YOLO

        model = YOLO(model_path)

    model.add_callback("on_fit_epoch_end", emit_trainer_epoch_metrics)
    model.train(**train_args)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ultralytics_train failed: {exc}", file=sys.stderr)
        raise
