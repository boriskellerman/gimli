#!/usr/bin/env bash
# Build the Gimli sandbox browser Docker image with Playwright support.
# This image includes browser automation capabilities for web interactions.
# Usage: ./scripts/sandbox-browser-setup.sh
set -euo pipefail

IMAGE_NAME="gimli-sandbox-browser:bookworm-slim"

docker build -t "${IMAGE_NAME}" -f docker/Dockerfile.sandbox-browser .
echo "Built ${IMAGE_NAME}"
