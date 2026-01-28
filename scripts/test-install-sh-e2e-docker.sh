#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${GIMLI_INSTALL_E2E_IMAGE:-gimli-install-e2e:local}"
INSTALL_URL="${GIMLI_INSTALL_URL:-https://gimli.bot/install.sh}"

OPENAI_API_KEY="${OPENAI_API_KEY:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
ANTHROPIC_API_TOKEN="${ANTHROPIC_API_TOKEN:-}"
GIMLI_E2E_MODELS="${GIMLI_E2E_MODELS:-}"

echo "==> Build image: $IMAGE_NAME"
docker build \
  -t "$IMAGE_NAME" \
  -f "$ROOT_DIR/scripts/docker/install-sh-e2e/Dockerfile" \
  "$ROOT_DIR/scripts/docker/install-sh-e2e"

echo "==> Run E2E installer test"
docker run --rm \
  -e GIMLI_INSTALL_URL="$INSTALL_URL" \
  -e GIMLI_INSTALL_TAG="${GIMLI_INSTALL_TAG:-latest}" \
  -e GIMLI_E2E_MODELS="$GIMLI_E2E_MODELS" \
  -e GIMLI_INSTALL_E2E_PREVIOUS="${GIMLI_INSTALL_E2E_PREVIOUS:-}" \
  -e GIMLI_INSTALL_E2E_SKIP_PREVIOUS="${GIMLI_INSTALL_E2E_SKIP_PREVIOUS:-0}" \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -e ANTHROPIC_API_TOKEN="$ANTHROPIC_API_TOKEN" \
  "$IMAGE_NAME"
