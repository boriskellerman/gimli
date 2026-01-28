#!/usr/bin/env bash
set -euo pipefail

cd /repo

export GIMLI_STATE_DIR="/tmp/gimli-test"
export GIMLI_CONFIG_PATH="${GIMLI_STATE_DIR}/gimli.json"

echo "==> Seed state"
mkdir -p "${GIMLI_STATE_DIR}/credentials"
mkdir -p "${GIMLI_STATE_DIR}/agents/main/sessions"
echo '{}' >"${GIMLI_CONFIG_PATH}"
echo 'creds' >"${GIMLI_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${GIMLI_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm gimli reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${GIMLI_CONFIG_PATH}"
test ! -d "${GIMLI_STATE_DIR}/credentials"
test ! -d "${GIMLI_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${GIMLI_STATE_DIR}/credentials"
echo '{}' >"${GIMLI_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm gimli uninstall --state --yes --non-interactive

test ! -d "${GIMLI_STATE_DIR}"

echo "OK"
