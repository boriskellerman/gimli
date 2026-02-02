#!/usr/bin/env bash
# Build the Gimli sandbox Docker image for isolated session execution.
# This image provides a secure environment for non-main sessions.
# Usage: ./scripts/sandbox-setup.sh
set -euo pipefail

IMAGE_NAME="gimli-sandbox:bookworm-slim"

docker build -t "${IMAGE_NAME}" -f docker/Dockerfile.sandbox .
echo "Built ${IMAGE_NAME}"
