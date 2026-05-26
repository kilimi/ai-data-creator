"""DJI MMYOLO repository preparation (clone, patch, install)."""
import logging
import os
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def prepare_dji_mmyolo_repo(patch_path: str) -> Path:
    """
    Prepare MMYOLO repo using DJI workflow:
    - clone open-mmlab/mmyolo from GitHub
    - checkout tags/v0.6.0 (DJI requirement)
    - create/switch branch drone-model-training
    - apply DJI patch (0001-NEW-ai-inside-init.patch)
    - install editable package
    """
    repo_root = Path(os.environ.get("MMYOLO_DJI_REPO_DIR", "/app/data/mmyolo_dji"))
    repo_dir = repo_root / "mmyolo"
    patch_file = Path(patch_path)

    if not patch_file.exists():
        raise FileNotFoundError(
            f"DJI patch file not found: {patch_file}\n"
            "Please ensure the patch file is available at the specified path."
        )

    repo_root.mkdir(parents=True, exist_ok=True)
    logger.info(f"Preparing DJI MMYolo repo at {repo_dir}")

    if not (repo_dir / ".git").exists():
        logger.info("Cloning mmyolo repository from GitHub...")
        try:
            result = subprocess.run(
                ["git", "clone", "https://github.com/open-mmlab/mmyolo.git", str(repo_dir)],
                check=True,
                capture_output=True,
                text=True,
            )
            logger.info(f"Clone successful: {result.stdout}")
        except subprocess.CalledProcessError as e:
            raise RuntimeError(
                f"Failed to clone mmyolo repository:\n"
                f"Command: {' '.join(e.cmd)}\n"
                f"Return code: {e.returncode}\n"
                f"Stdout: {e.stdout}\n"
                f"Stderr: {e.stderr}"
            )

    logger.info("Fetching git tags...")
    try:
        subprocess.run(
            ["git", "-C", str(repo_dir), "fetch", "--tags"],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as e:
        logger.warning(f"Git fetch failed (non-fatal): {e.stderr}")

    logger.info("Checking out mmyolo v0.6.0 (DJI requirement)...")
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_dir), "checkout", "tags/v0.6.0"],
            check=True,
            capture_output=True,
            text=True,
        )
        logger.info(f"Checkout successful: {result.stdout}")
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"Failed to checkout mmyolo v0.6.0:\n"
            f"Stderr: {e.stderr}\n"
            "This version is required for DJI drone compatibility."
        )

    branch_exists = (
        subprocess.run(
            ["git", "-C", str(repo_dir), "show-ref", "--verify", "--quiet", "refs/heads/drone-model-training"],
            capture_output=True,
        ).returncode
        == 0
    )

    if branch_exists:
        logger.info("Switching to existing drone-model-training branch...")
        subprocess.run(
            ["git", "-C", str(repo_dir), "switch", "drone-model-training"],
            check=True,
            capture_output=True,
        )
    else:
        logger.info("Creating new drone-model-training branch...")
        subprocess.run(
            ["git", "-C", str(repo_dir), "switch", "-c", "drone-model-training"],
            check=True,
            capture_output=True,
        )

    logger.info(f"Checking if DJI patch can be applied: {patch_file}")
    can_apply = (
        subprocess.run(
            ["git", "-C", str(repo_dir), "apply", "--check", str(patch_file)],
            capture_output=True,
        ).returncode
        == 0
    )

    if can_apply:
        logger.info("Applying DJI patch...")
        try:
            result = subprocess.run(
                ["git", "-C", str(repo_dir), "apply", str(patch_file)],
                check=True,
                capture_output=True,
                text=True,
            )
            logger.info(f"Patch applied successfully: {result.stdout}")
        except subprocess.CalledProcessError as e:
            raise RuntimeError(
                f"Failed to apply DJI patch:\n"
                f"Patch file: {patch_file}\n"
                f"Stderr: {e.stderr}"
            )
    else:
        logger.info("DJI patch already applied or not applicable, skipping.")

    logger.info(f"Installing mmyolo in editable mode from {repo_dir}...")
    try:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "-e", str(repo_dir)],
            check=True,
            capture_output=True,
            text=True,
        )
        logger.info("Installation successful")
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"Failed to install mmyolo:\n"
            f"Stderr: {e.stderr}\n"
            f"Stdout: {e.stdout}"
        )

    logger.info(f"DJI MMYolo repo prepared successfully at {repo_dir}")
    return repo_dir
