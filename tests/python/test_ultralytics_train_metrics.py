"""Tests for structured LAI_METRICS lines from the Ultralytics training subprocess."""
from __future__ import annotations

import json

from app.ml.ultralytics_train_metrics import (
    LAI_METRICS_PREFIX,
    parse_lai_metrics_line,
)


def test_parse_lai_metrics_line():
    payload = {"epoch": 3, "box_loss": 1.2, "mAP50": 0.45, "mAP50_95": 0.22}
    line = LAI_METRICS_PREFIX + json.dumps(payload)
    parsed = parse_lai_metrics_line(line)
    assert parsed == payload


def test_parse_lai_metrics_line_invalid():
    assert parse_lai_metrics_line("not metrics") is None
    assert parse_lai_metrics_line(LAI_METRICS_PREFIX + "{bad") is None
