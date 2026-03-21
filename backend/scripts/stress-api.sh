#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TOTAL_REQUESTS="${TOTAL_REQUESTS:-200}"
CONCURRENCY="${CONCURRENCY:-20}"
TARGET_SUCCESS_RATE="${TARGET_SUCCESS_RATE:-95}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT

echo "[stress] base_url=$BASE_URL total=$TOTAL_REQUESTS concurrency=$CONCURRENCY"

SUCCESS_RATE_ENABLED=true
if ! curl -fsS "$BASE_URL/metrics/success-rate" >/dev/null 2>&1; then
  SUCCESS_RATE_ENABLED=false
  echo "[stress] note: /metrics/success-rate not available on target; probing /health and /metrics only"
fi

run_probe() {
  local base="$1"
  local ok=true
  curl -fsS "$base/health" >/dev/null || ok=false
  curl -fsS "$base/metrics" >/dev/null || ok=false
  if [[ "$SUCCESS_RATE_ENABLED" == "true" ]]; then
    curl -fsS "$base/metrics/success-rate" >/dev/null || ok=false
  fi

  if [[ "$ok" == "true" ]]; then
    echo ok
  else
    echo fail
  fi
}

export -f run_probe
export BASE_URL
export SUCCESS_RATE_ENABLED

seq "$TOTAL_REQUESTS" \
  | xargs -I{} -P "$CONCURRENCY" bash -c 'run_probe "$BASE_URL"' \
  >> "$tmp_file"

ok_count="$(grep -c '^ok$' "$tmp_file" || true)"
fail_count="$(grep -c '^fail$' "$tmp_file" || true)"

if [[ "$TOTAL_REQUESTS" -eq 0 ]]; then
  echo "[stress] TOTAL_REQUESTS must be > 0" >&2
  exit 1
fi

success_rate="$(awk -v ok="$ok_count" -v total="$TOTAL_REQUESTS" 'BEGIN { printf "%.2f", (ok/total)*100 }')"

echo "[stress] ok=$ok_count fail=$fail_count success_rate=${success_rate}%"

if awk -v s="$success_rate" -v min="$TARGET_SUCCESS_RATE" 'BEGIN { exit !(s+0 >= min+0) }'; then
  echo "[stress] PASS: success rate >= ${TARGET_SUCCESS_RATE}%"
else
  echo "[stress] FAIL: success rate < ${TARGET_SUCCESS_RATE}%" >&2
  exit 1
fi
