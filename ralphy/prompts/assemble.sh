#!/usr/bin/env bash
# Assemble a composable prompt from meta-prompt + sections
#
# Usage:
#   ./assemble.sh bug --task-id TASK-123 --title "Fix gateway crash" --scope gateway --priority high
#   ./assemble.sh feature --task-id TASK-124 --title "Add widget" --priority medium
#   ./assemble.sh chore --task-id TASK-125 --title "Upgrade deps"
#   ./assemble.sh research --task-id TASK-126 --title "Evaluate tool X"
#
# Output: assembled prompt to stdout (pipe to file or clipboard)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECTIONS_DIR="$SCRIPT_DIR/sections"
META_DIR="$SCRIPT_DIR/meta"

usage() {
  echo "Usage: $0 <type> [--var value ...]"
  echo ""
  echo "Types: bug, feature, chore, research"
  echo ""
  echo "Variables:"
  echo "  --task-id       Task identifier (e.g., TASK-069)"
  echo "  --title         Short description"
  echo "  --priority      critical|high|medium|low"
  echo "  --scope         Affected component(s)"
  echo "  --files         Known files to modify"
  echo "  --criteria      Acceptance criteria"
  echo "  --context       Additional background"
  echo "  --domain        Expert domain (gateway|channels|security|database)"
  echo "  --max-iter      Max self-correction attempts (default: 3)"
  exit 1
}

TYPE="${1:-}"
[ -z "$TYPE" ] && usage
shift

# Parse variables
TASK_ID="" TASK_TITLE="" PRIORITY="medium" SCOPE="" FILES=""
CRITERIA="" CONTEXT="" DOMAIN="" MAX_ITER="3"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-id)    TASK_ID="$2"; shift 2;;
    --title)      TASK_TITLE="$2"; shift 2;;
    --priority)   PRIORITY="$2"; shift 2;;
    --scope)      SCOPE="$2"; shift 2;;
    --files)      FILES="$2"; shift 2;;
    --criteria)   CRITERIA="$2"; shift 2;;
    --context)    CONTEXT="$2"; shift 2;;
    --domain)     DOMAIN="$2"; shift 2;;
    --max-iter)   MAX_ITER="$2"; shift 2;;
    *)            echo "Unknown option: $1"; usage;;
  esac
done

# Check meta-prompt exists
META_FILE="$META_DIR/$TYPE.md"
if [ ! -f "$META_FILE" ]; then
  echo "Error: Unknown prompt type '$TYPE'" >&2
  echo "Available: $(ls "$META_DIR"/*.md 2>/dev/null | xargs -I{} basename {} .md | tr '\n' ', ')" >&2
  exit 1
fi

# Read and substitute
PROMPT=$(cat "$META_FILE")

# Substitute variables
PROMPT="${PROMPT//\{\{TASK_ID\}\}/$TASK_ID}"
PROMPT="${PROMPT//\{\{TASK_TITLE\}\}/$TASK_TITLE}"
PROMPT="${PROMPT//\{\{TASK_TYPE\}\}/$TYPE}"
PROMPT="${PROMPT//\{\{PRIORITY\}\}/$PRIORITY}"
PROMPT="${PROMPT//\{\{SCOPE\}\}/$SCOPE}"
PROMPT="${PROMPT//\{\{FILES\}\}/$FILES}"
PROMPT="${PROMPT//\{\{ACCEPTANCE_CRITERIA\}\}/$CRITERIA}"
PROMPT="${PROMPT//\{\{CONTEXT\}\}/$CONTEXT}"
PROMPT="${PROMPT//\{\{EXPERT_DOMAIN\}\}/$DOMAIN}"
PROMPT="${PROMPT//\{\{MAX_ITERATIONS\}\}/$MAX_ITER}"
PROMPT="${PROMPT//\{\{LEARNING\}\}/[describe what you learned]}"

echo "$PROMPT"
