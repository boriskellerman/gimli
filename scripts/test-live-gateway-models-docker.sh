#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${GIMLI_IMAGE:-gimli:local}"
CONFIG_DIR="${GIMLI_CONFIG_DIR:-$HOME/.gimli}"
WORKSPACE_DIR="${GIMLI_WORKSPACE_DIR:-$HOME/gimli}"
PROFILE_FILE="${GIMLI_PROFILE_FILE:-$HOME/.profile}"

PROFILE_MOUNT=()
if [[ -f "$PROFILE_FILE" ]]; then
  PROFILE_MOUNT=(-v "$PROFILE_FILE":/home/node/.profile:ro)
fi

echo "==> Build image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" -f "$ROOT_DIR/Dockerfile" "$ROOT_DIR"

echo "==> Run gateway live model tests (profile keys)"
docker run --rm -t \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS=--disable-warning=ExperimentalWarning \
  -e GIMLI_LIVE_TEST=1 \
  -e GIMLI_LIVE_GATEWAY_MODELS="${GIMLI_LIVE_GATEWAY_MODELS:-all}" \
  -e GIMLI_LIVE_GATEWAY_PROVIDERS="${GIMLI_LIVE_GATEWAY_PROVIDERS:-}" \
  -e GIMLI_LIVE_GATEWAY_MODEL_TIMEOUT_MS="${GIMLI_LIVE_GATEWAY_MODEL_TIMEOUT_MS:-}" \
  -v "$CONFIG_DIR":/home/node/.gimli \
  -v "$WORKSPACE_DIR":/home/node/gimli \
  "${PROFILE_MOUNT[@]}" \
  "$IMAGE_NAME" \
  -lc "set -euo pipefail; [ -f \"$HOME/.profile\" ] && source \"$HOME/.profile\" || true; cd /app && pnpm test:live"
