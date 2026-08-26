#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${SILONR_ENV_FILE:-$repo_root/deploy/pilot/.env}"
compose=(docker compose --env-file "$env_file" -f "$repo_root/docker-compose.pilot.yml")

[[ -f "$env_file" ]] || { echo "[pilot-deploy] missing $env_file" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

cd "$repo_root"
"$repo_root/scripts/pilot-preflight.sh"
"${compose[@]}" up -d --build --wait

wait_for() {
  local name="$1" url="$2"
  for _ in $(seq 1 60); do
    if curl --fail --silent --show-error --max-time 10 "$url" >/dev/null; then
      echo "[pilot-deploy] PASS: $name"
      return 0
    fi
    sleep 2
  done
  echo "[pilot-deploy] FAIL: $name did not become healthy: $url" >&2
  "${compose[@]}" ps >&2
  "${compose[@]}" logs --tail=150 app caddy postgres minio >&2
  return 1
}

wait_for "application liveness" "https://$SILONR_DOMAIN/api/health/live"
wait_for "application readiness" "https://$SILONR_DOMAIN/api/health/ready"
wait_for "private storage" "https://$SILONR_FILES_DOMAIN/minio/health/live"

signup_status="$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}'   --request POST "https://$SILONR_DOMAIN/api/auth/sign-up/email"   --header 'content-type: application/json'   --data '{"name":"Preflight Probe","email":"blocked-signup@example.invalid","password":"Must-Remain-Blocked-2026!"}')"
if [[ "$signup_status" == 2* ]]; then
  echo "[pilot-deploy] FAIL: public signup returned HTTP $signup_status" >&2
  exit 1
fi

"${compose[@]}" ps
echo "[pilot-deploy] PASS: HTTPS stack is ready and public signup is closed"
