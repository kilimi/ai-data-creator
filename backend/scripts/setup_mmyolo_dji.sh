#!/usr/bin/env sh
set -eu

REPO_DIR="${MMYOLO_DJI_REPO_DIR:-/opt/mmyolo-dji}"
PATCH_FILE="${MMYOLO_DJI_PATCH_FILE:-/opt/dji_patch/0001-NEW-ai-inside-init.patch}"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[mmyolo-dji] Cloning MMYOLO repository..."
  git clone https://github.com/open-mmlab/mmyolo.git "$REPO_DIR"
fi

cd "$REPO_DIR"

echo "[mmyolo-dji] Checking out v0.6.0..."
git fetch --tags
git checkout tags/v0.6.0

if git show-ref --verify --quiet refs/heads/drone-model-training; then
  git switch drone-model-training
else
  git switch -c drone-model-training
fi

if [ ! -f "$PATCH_FILE" ]; then
  echo "[mmyolo-dji] ERROR: required patch file not found: $PATCH_FILE" >&2
  exit 1
fi

if git apply --check "$PATCH_FILE" >/dev/null 2>&1; then
  echo "[mmyolo-dji] Applying DJI patch: $PATCH_FILE"
  git apply "$PATCH_FILE"
else
  echo "[mmyolo-dji] Patch already applied or not applicable, continuing."
fi

echo "[mmyolo-dji] Installing MMYOLO (editable) from $REPO_DIR"
pip install --no-cache-dir -e "$REPO_DIR"

python -c "import mmyolo; print('mmyolo version loaded:', getattr(mmyolo, '__version__', 'unknown'))"
