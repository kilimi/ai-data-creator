#!/usr/bin/env bash
# Build slim compose-only distribution tarball for GitHub Releases.
# Usage: bash scripts/build_dist_bundle.sh [version]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(python -c 'import lai; print(lai.__version__)' 2>/dev/null || echo 0.1.0)}"
VERSION="${VERSION#v}"
OUT_DIR="${ROOT}/dist"
ARCHIVE="${OUT_DIR}/lai-dist-${VERSION}.tar.gz"
STAGE="${OUT_DIR}/lai-dist-${VERSION}"

rm -rf "$STAGE"
mkdir -p "$STAGE/dockers/backend" "$STAGE/scripts" "$STAGE/licenses"

# Compose stack (pull-only; no application source).
cp "$ROOT/docker-compose.yml" "$STAGE/"
cp "$ROOT/docker-compose.code-mount.yml" "$STAGE/"
cp "$ROOT/dockers/docker-compose.yml" "$STAGE/dockers/"
cp "$ROOT/dockers/docker-compose.code-mount.yml" "$STAGE/dockers/"
cp "$ROOT/dockers/backend/docker-compose.yml" "$STAGE/dockers/backend/"

# Install helpers and legal files.
cp "$ROOT/scripts/install.sh" "$STAGE/scripts/"
cp "$ROOT/scripts/write_registry_env.py" "$STAGE/scripts/"
cp "$ROOT/LICENSE" "$ROOT/NOTICE" "$ROOT/THIRD_PARTY_LICENSES.md" "$STAGE/"
cp "$ROOT/licenses/"*.txt "$STAGE/licenses/"

# Pre-filled .env example (registry tags filled at release time in CI).
ORG="${LAI_GHCR_ORG:-lulu}"
cat > "$STAGE/.env.example" <<EOF
# LAI pull-only install — copy to .env via: lai install-gui  or  lai install
LAI_DATA_DIR=\${HOME}/lai-data
WEB_PORT=8089
VITE_API_URL=SAME_ORIGIN
LAI_BIND_CODE=0
LAI_GPU_TIER=0
COMPOSE_FILE=docker-compose.yml
LAI_RELEASE_VERSION=${VERSION}
LAI_BACKEND_IMAGE=ghcr.io/${ORG}/lai-backend:${VERSION}
LAI_WORKER_GENERAL_IMAGE=ghcr.io/${ORG}/lai-worker-general:${VERSION}
LAI_WORKER_GPU_IMAGE=ghcr.io/${ORG}/lai-worker-gpu:${VERSION}
LAI_FRONTEND_IMAGE=ghcr.io/${ORG}/lai-frontend:${VERSION}
LAI_SAM_IMAGE=ghcr.io/${ORG}/lai-sam:${VERSION}
LAI_ULTRALYTICS_IMAGE=ghcr.io/${ORG}/lai-ultralytics:${VERSION}
LAI_MMYOLO_IMAGE=ghcr.io/${ORG}/lai-mmyolo:${VERSION}
SAM3_MODELS_HOST_PATH=\${HOME}/lai-data/sam3-models
SAM3_CHECKPOINT_FILENAME=sam3.pt
EOF

mkdir -p "$OUT_DIR"
tar -czf "$ARCHIVE" -C "$OUT_DIR" "lai-dist-${VERSION}"
echo "Created $ARCHIVE"
