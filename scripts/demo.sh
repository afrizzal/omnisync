#!/usr/bin/env bash
# OPS-03 (D-04): one-command OmniSync demo — brings up the full stack and runs the load test.
set -euo pipefail

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example to .env first:  cp .env.example .env"
  exit 1
fi

# Export all vars from .env so the host-run load test sees WEBHOOK_SECRET_* values
set -a
# shellcheck disable=SC1091
source .env
set +a

echo "==> Starting OmniSync full stack (api, worker, postgres, redis, mock-crm, dashboard)..."
docker compose up --build -d

echo "==> Waiting for API health on :3001 ..."
timeout 120 bash -c 'until curl -sf http://localhost:3001/healthz >/dev/null; do sleep 2; done'
echo "==> Waiting for dashboard on :3000 ..."
timeout 120 bash -c 'until curl -sf http://localhost:3000 >/dev/null; do sleep 2; done'

echo "==> Running load test (${LOAD_DURATION_S:-30}s)..."
if command -v node >/dev/null 2>&1; then
  INGEST_BASE_URL="${INGEST_BASE_URL:-http://localhost:3001}" \
    tsx scripts/loadtest.ts
else
  echo "    NOTE: node not found in this shell (WSL without Node.js)."
  echo "    Stack is running. Run the load test separately from PowerShell:"
  echo "      pnpm --filter @omnisync/api tsx scripts/loadtest.ts"
  echo "    Or open http://localhost:3000/demo — the dashboard updates live."
fi

echo ""
echo "==> Demo running. Open the dashboard:  http://localhost:3000/demo"
echo "==> Toggle the circuit breaker:  curl -X POST http://localhost:3002/admin/failure-mode -H 'content-type: application/json' -d '{\"mode\":\"fail\",\"rate\":1}'"
echo "==> Stop everything:  docker compose down -v"
