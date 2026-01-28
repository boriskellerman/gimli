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

echo "==> Run live model tests (profile keys)"
docker run --rm -t \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS=--disable-warning=ExperimentalWarning \
  -e GIMLI_LIVE_TEST=1 \
  -e GIMLI_LIVE_MODELS="${GIMLI_LIVE_MODELS:-all}" \
  -e GIMLI_LIVE_PROVIDERS="${GIMLI_LIVE_PROVIDERS:-}" \
  -e GIMLI_LIVE_MODEL_TIMEOUT_MS="${GIMLI_LIVE_MODEL_TIMEOUT_MS:-}" \
  -e GIMLI_LIVE_REQUIRE_PROFILE_KEYS="${GIMLI_LIVE_REQUIRE_PROFILE_KEYS:-}" \
  -v "$CONFIG_DIR":/home/node/.gimli \
  -v "$WORKSPACE_DIR":/home/node/gimli \
  "${PROFILE_MOUNT[@]}" \
  "$IMAGE_NAME" \
  -lc "set -euo pipefail; [ -f \"$HOME/.profile\" ] && source \"$HOME/.profile\" || true; cd /app && pnpm test:live"
