#!/usr/bin/env bash
# E2E test: runs an ABS session against the mock agent.
# Requires: python3, node, typescript/dist/cli.js built.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CLI="$PROJECT_DIR/typescript/dist/cli.js"
MOCK_AGENT="$PROJECT_DIR/tools/mock_agent.py"
SESSION="$PROJECT_DIR/examples/order-status-missing-info.yaml"

# Find a free port
PORT=8765
while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT + 1)); done

echo "==> Starting mock agent on port $PORT..."
python3 "$MOCK_AGENT" --port "$PORT" --scenario missing_info &
MOCK_PID=$!
sleep 1

cleanup() {
  echo "==> Stopping mock agent (pid $MOCK_PID)..."
  kill "$MOCK_PID" 2>/dev/null || true
  wait "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Verify mock agent is alive
if ! curl -s "http://localhost:$PORT/health" >/dev/null 2>&1; then
  echo "❌ Mock agent failed to start"
  exit 1
fi
echo "✅ Mock agent ready"

# Run the session
echo "==> Running session: $SESSION"
set +e
RESULT=$(node "$CLI" run "$SESSION" \
  --agent "http://localhost:$PORT/chat" \
  --agent-format openai \
  --format json \
  --ci 2>&1)
EXIT_CODE=$?
set -e

echo ""
echo "==> Result:"
echo "$RESULT" | head -40

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "❌ E2E test FAILED (exit code $EXIT_CODE)"
  exit 1
fi

# Check the JSON report
PASSED=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['passed'])" 2>/dev/null || echo "false")

if [ "$PASSED" = "True" ]; then
  echo ""
  echo "✅ E2E test PASSED"
else
  echo ""
  echo "❌ E2E test FAILED — session did not pass"
  exit 1
fi
