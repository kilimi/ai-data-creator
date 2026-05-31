"""Docker Compose must define split workers (not only celery_worker)."""
from pathlib import Path

import yaml


def test_compose_defines_worker_general_and_gpu():
    compose_path = Path(__file__).resolve().parents[2] / "backend" / "docker-compose.yml"
    data = yaml.safe_load(compose_path.read_text(encoding="utf-8"))
    services = data.get("services", {})
    assert "worker-general" in services
    assert "worker-gpu" in services
    assert "celery-beat" in services
    assert "celery_worker" not in services


def test_code_mount_targets_both_workers():
    mount_path = Path(__file__).resolve().parents[2] / "docker-compose.code-mount.yml"
    data = yaml.safe_load(mount_path.read_text(encoding="utf-8"))
    services = data.get("services", {})
    assert "worker-general" in services
    assert "worker-gpu" in services
