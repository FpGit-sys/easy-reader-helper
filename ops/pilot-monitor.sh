#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${SILONR_ENV_FILE:-$repo_root/deploy/pilot/.env}"
state_dir="${PILOT_MONITOR_STATE_DIR:-/var/lib/silonr-monitor}"
threshold="${PILOT_MONITOR_FAILURE_THRESHOLD:-3}"
compose=(docker compose --env-file "$env_file" -f "$repo_root/docker-compose.pilot.yml")

[[ -f "$env_file" ]] || { echo "[pilot-monitor] missing $env_file" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a
[[ "$threshold" =~ ^[1-9][0-9]*$ ]] || { echo "[pilot-monitor] invalid failure threshold" >&2; exit 1; }
mkdir -p "$state_dir"

problems=()
check_url() {
  local label="$1" url="$2"
  if ! curl --fail --silent --show-error --max-time 10 "$url" >/dev/null; then
    problems+=("$label failed: $url")
  fi
}
check_url "application liveness" "https://$SILONR_DOMAIN/api/health/live"
check_url "application readiness" "https://$SILONR_DOMAIN/api/health/ready"
check_url "private storage" "https://$SILONR_FILES_DOMAIN/minio/health/live"

running="$("${compose[@]}" ps --status running --services 2>/dev/null || true)"
for service in postgres minio app caddy; do
  grep -qx "$service" <<<"$running" || problems+=("container is not running: $service")
done

if "${compose[@]}" logs --since "${PILOT_MONITOR_LOG_WINDOW:-2m}" app 2>/dev/null |
  grep -Eiq '"event"[[:space:]]*:[[:space:]]*"http\.request".*"status(Code)?"[[:space:]]*:[[:space:]]*5[0-9]{2}'; then
  problems+=("application emitted HTTP 5xx in the monitoring window")
fi

count_file="$state_dir/consecutive-failures"
alerted_file="$state_dir/alerted"
count="$(cat "$count_file" 2>/dev/null || echo 0)"
[[ "$count" =~ ^[0-9]+$ ]] || count=0

notify() {
  local status="$1" message="$2"
  payload="$(STATUS="$status" MESSAGE="$message" HOSTNAME_VALUE="$(hostname)" python3 - <<'PY'
import json, os
print(json.dumps({
    "service": "SiloNR pilot",
    "status": os.environ["STATUS"],
    "host": os.environ["HOSTNAME_VALUE"],
    "message": os.environ["MESSAGE"],
}))
PY
)"
  curl --fail --silent --show-error --max-time 15     --header 'content-type: application/json'     --data "$payload" "$PILOT_ALERT_WEBHOOK_URL" >/dev/null
}

if (("${#problems[@]}" > 0)); then
  count=$((count + 1))
  printf '%s
' "$count" >"$count_file"
  printf '%s
' "${problems[@]}" >&2
  if ((count >= threshold)) && [[ ! -f "$alerted_file" ]]; then
    message="$(printf '%s; ' "${problems[@]}")"
    if notify "firing" "$message"; then
      date -u +%FT%TZ >"$alerted_file"
    fi
  fi
  exit 1
fi

printf '0
' >"$count_file"
if [[ -f "$alerted_file" ]]; then
  if notify "recovered" "All HTTPS, container and HTTP 5xx checks are healthy."; then
    rm -f "$alerted_file"
  fi
fi
echo "[pilot-monitor] PASS: all checks healthy"
