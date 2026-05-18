"""
System resource endpoints (GPU availability and memory usage).

GPU is read on the backend (e.g. inside Docker). The backend runs in a single
environment (typically Linux in Docker), so client OS (Windows/Linux/macOS)
does not matter — the navbar always shows whatever GPU the backend container sees.
"""
import logging
import shutil
import subprocess
from typing import Any, List

from fastapi import APIRouter

router = APIRouter()
logger = logging.getLogger(__name__)


def _run_nvidia_smi(exe: str) -> List[dict[str, Any]]:
    """Run nvidia-smi with given executable path; return list of GPU dicts or empty."""
    try:
        out = subprocess.run(
            [
                exe,
                "--query-gpu=name,memory.used,memory.total,utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if out.returncode != 0 or not out.stdout.strip():
            if out.stderr:
                logger.debug("nvidia-smi %s: returncode=%s stderr=%s", exe, out.returncode, out.stderr[:200])
            return []
        gpus = []
        for line in out.stdout.strip().split("\n"):
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 4:
                try:
                    name = parts[0]
                    mem_used = int(float(parts[1].replace("MiB", "").strip() or 0))
                    mem_total = int(float(parts[2].replace("MiB", "").strip() or 0))
                    util = int(float(parts[3].replace("%", "").strip() or 0))
                    gpus.append({
                        "name": name,
                        "memory_used_mb": mem_used,
                        "memory_total_mb": mem_total,
                        "utilization_percent": min(100, max(0, util)),
                    })
                except (ValueError, IndexError):
                    continue
        return gpus
    except FileNotFoundError:
        return []
    except subprocess.TimeoutExpired:
        return []
    except Exception as e:
        logger.debug("nvidia-smi %s failed: %s", exe, e)
        return []


def _query_gpu_nvidia_smi() -> tuple[List[dict[str, Any]], list[str]]:
    """Query GPU info via nvidia-smi. Returns (gpus, debug_messages)."""
    debug: list[str] = []
    # Try: which('nvidia-smi'), then explicit paths (toolkit mounts at host path, often /usr/bin)
    candidates: list[str] = []
    which_path = shutil.which("nvidia-smi")
    if which_path:
        candidates.append(which_path)
    candidates.extend(["nvidia-smi", "/usr/bin/nvidia-smi"])
    seen = set()
    for exe in candidates:
        if not exe or exe in seen:
            continue
        seen.add(exe)
        try:
            gpus = _run_nvidia_smi(exe)
            if gpus:
                logger.info("GPU detected via %s: %d device(s)", exe, len(gpus))
                return gpus, debug
        except Exception as e:
            debug.append(f"{exe}: {e}")
    debug.append(
        "nvidia-smi not found or failed. In Docker: ensure backend has runtime: nvidia and "
        "deploy.reservations.devices (nvidia). On host: install nvidia-container-toolkit and run: docker compose up -d --force-recreate backend"
    )
    logger.info("No GPU from nvidia-smi. %s", debug[-1])
    return [], debug


def _query_gpu_torch() -> List[dict[str, Any]]:
    """Query GPU info via PyTorch if available."""
    try:
        import torch
        if not torch.cuda.is_available():
            return []
        gpus = []
        for i in range(torch.cuda.device_count()):
            props = torch.cuda.get_device_properties(i)
            total_mb = props.total_memory // (1024 * 1024)
            # Allocated by current process (may be 0 in API process)
            try:
                used_mb = torch.cuda.memory_allocated(i) // (1024 * 1024)
            except Exception:
                used_mb = 0
            gpus.append({
                "name": props.name,
                "memory_used_mb": used_mb,
                "memory_total_mb": total_mb,
                "utilization_percent": 0,  # torch doesn't give utilization
            })
        logger.info("GPU detected via PyTorch CUDA: %d device(s)", len(gpus))
        return gpus
    except ImportError:
        return []
    except Exception as e:
        logger.debug("torch cuda query failed: %s", e)
        return []


@router.get("/system/gpu")
async def get_gpu_status(debug: bool = False) -> dict[str, Any]:
    """
    Return GPU availability and memory usage for the backend (e.g. Docker) environment.
    Tries nvidia-smi first (full memory/utilization), then PyTorch CUDA if available.
    Add ?debug=1 to the URL to include a hint when no GPU is detected.
    """
    gpus, nvidia_debug = _query_gpu_nvidia_smi()
    if not gpus:
        gpus = _query_gpu_torch()
    total_used_mb = sum(g["memory_used_mb"] for g in gpus)
    total_mb = sum(g["memory_total_mb"] for g in gpus)
    # If we got GPUs from torch, memory_used may be 0; nvidia-smi gives system-wide
    if gpus and total_used_mb == 0 and total_mb > 0:
        again, _ = _query_gpu_nvidia_smi()
        if again:
            gpus = again
            total_used_mb = sum(g["memory_used_mb"] for g in gpus)
            total_mb = sum(g["memory_total_mb"] for g in gpus)
    out: dict[str, Any] = {
        "has_gpu": len(gpus) > 0,
        "gpu_count": len(gpus),
        "gpus": gpus,
        "memory_used_mb": total_used_mb,
        "memory_total_mb": total_mb,
    }
    if debug and not gpus and nvidia_debug:
        out["debug"] = nvidia_debug
    return out


# ---------------------------------------------------------------------------
# Foundation model inventory
# ---------------------------------------------------------------------------
from pathlib import Path as _Path

from ..foundation_models import (
    ARCH_SIZES,
    DEPTH_ONNX_NAMES,
    ultralytics_foundation_pt_names,
)
from ..model_weights_presence import PRETRAINED_MODELS_DIR, DEPTH_MODELS_DIR


def _yolo_meta(filename: str) -> dict[str, Any]:
    """Derive arch / size / task labels from a YOLO .pt filename."""
    stem = filename[:-3] if filename.endswith(".pt") else filename
    if stem.endswith("-seg"):
        task = "segment"
        base = stem[:-4]
    elif stem.endswith("-cls"):
        task = "classify"
        base = stem[:-4]
    else:
        task = "detect"
        base = stem
    arch, size = base, ""
    for a, s in ARCH_SIZES:
        candidate = f"{a}_{s}" if a == "yolo_nas" else f"{a}{s}"
        if candidate == base:
            arch, size = a, s
            break
    return {"arch": arch, "size": size, "task": task}


def _depth_meta(filename: str) -> dict[str, str]:
    # depth_anything_v2_<variant>_<environment>_dynamic.onnx
    parts = filename.replace("depth_anything_v2_", "").split("_")
    variant = parts[0] if parts else ""
    environment = parts[1] if len(parts) > 1 else ""
    return {"variant": variant, "environment": environment}


def _present(path: _Path) -> tuple[bool, int]:
    if path.is_file():
        try:
            return True, path.stat().st_size
        except OSError:
            return True, 0
    return False, 0


@router.get("/system/models")
async def list_foundation_models() -> dict[str, Any]:
    """
    Inventory the foundation weights mounted under /app/models and
    /app/ai_models/depth_estimation. Reports each known model as present
    or missing so the UI can guide users to fetch more.
    """
    yolo: list[dict[str, Any]] = []
    yolo_present = 0
    for fn in ultralytics_foundation_pt_names():
        ok, size = _present(PRETRAINED_MODELS_DIR / fn)
        if ok:
            yolo_present += 1
        meta = _yolo_meta(fn)
        yolo.append({
            "file": fn,
            "name": fn[:-3],
            "arch": meta["arch"],
            "size": meta["size"],
            "task": meta["task"],
            "present": ok,
            "size_mb": round(size / (1024 * 1024), 2) if size else 0,
        })

    depth: list[dict[str, Any]] = []
    depth_present = 0
    for fn in DEPTH_ONNX_NAMES:
        ok, size = _present(DEPTH_MODELS_DIR / fn)
        if ok:
            depth_present += 1
        meta = _depth_meta(fn)
        depth.append({
            "file": fn,
            "variant": meta["variant"],
            "environment": meta["environment"],
            "present": ok,
            "size_mb": round(size / (1024 * 1024), 2) if size else 0,
        })

    return {
        "yolo": yolo,
        "depth": depth,
        "summary": {
            "yolo_present": yolo_present,
            "yolo_total": len(yolo),
            "depth_present": depth_present,
            "depth_total": len(depth),
        },
        "paths": {
            "yolo_dir": str(PRETRAINED_MODELS_DIR),
            "depth_dir": str(DEPTH_MODELS_DIR),
        },
        "commands": {
            "all": "lai download-models --yolo all --depth all",
            "minimal": "lai download-models",
            "single_yolo": "lai download-models --yolo yolo11n-seg.pt",
            "single_depth": "lai download-models --depth depth_anything_v2_vitb_outdoor_dynamic.onnx",
            "direct": "docker compose exec backend python scripts/download_ultralytics_models.py",
        },
        "notice": (
            "Models live on a host volume — drop your own .pt files into the yolo_dir to use them. "
            "Missing weights are downloaded on demand the first time a job needs them (requires internet)."
        ),
    }
