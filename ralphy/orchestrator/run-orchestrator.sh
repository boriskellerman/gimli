#!/bin/bash
# TAC Orchestrator runner — sets gateway auth and runs the CLI
export GIMLI_PATH="/home/gimli/github/gimli"
export ORCHESTRATOR_PATH="$GIMLI_PATH/ralphy/orchestrator"
export GIMLI_GATEWAY_URL="http://localhost:18789"
export GIMLI_GATEWAY_TOKEN="5906575eb3ef7885289f3549a47c0886acec780c3fd9d963"
cd "$ORCHESTRATOR_PATH"
node dist/cli.js "$@"
