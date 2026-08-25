#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "[pilot-preflight] ERROR: $*" >&2
  exit 1
}

info() {
  echo "[pilot-preflight] $*"
}

required=(
  SILONR_DOMAIN
  SILONR_FILES_DOMAIN
  ACME_EMAIL
  POSTGRES_DB
  POSTGRES_USER
  POSTGRES_PASSWORD
  BETTER_AUTH_SECRET
  MINIO_ROOT_USER
  MINIO_ROOT_PASSWORD
  S3_ACCESS_KEY_ID
  S3_SECRET_ACCESS_KEY
  S3_BUCKET
)

for key in "${required[@]}"; do
  value="${!key:-}"
  [[ -n "$value" ]] || fail "$key is required"
done

validate_host() {
  local key="$1"
  local value="${!key}"
  [[ "$value" != *"://"* ]] || fail "$key must be a hostname without scheme"
  [[ "$value" != */* ]] || fail "$key must not contain a path"
  [[ "$value" =~ ^[A-Za-z0-9.-]+$ ]] || fail "$key contains invalid hostname characters"
  [[ "$value" == *.* ]] || fail "$key must be a fully qualified hostname"
}

validate_host SILONR_DOMAIN
validate_host SILONR_FILES_DOMAIN
[[ "$SILONR_DOMAIN" != "$SILONR_FILES_DOMAIN" ]] || fail "application and file hostnames must be different"
[[ "$ACME_EMAIL" == *@*.* ]] || fail "ACME_EMAIL does not look like an email address"

[[ ${#POSTGRES_PASSWORD} -ge 20 ]] || fail "POSTGRES_PASSWORD must contain at least 20 characters"
[[ ${#BETTER_AUTH_SECRET} -ge 32 ]] || fail "BETTER_AUTH_SECRET must contain at least 32 characters"
[[ ${#MINIO_ROOT_PASSWORD} -ge 20 ]] || fail "MINIO_ROOT_PASSWORD must contain at least 20 characters"
[[ ${#S3_SECRET_ACCESS_KEY} -ge 20 ]] || fail "S3_SECRET_ACCESS_KEY must contain at least 20 characters"
[[ ${#S3_ACCESS_KEY_ID} -ge 3 ]] || fail "S3_ACCESS_KEY_ID must contain at least 3 characters"

[[ "$POSTGRES_PASSWORD" != "$BETTER_AUTH_SECRET" ]] || fail "database and auth secrets must not be reused"
[[ "$POSTGRES_PASSWORD" != "$MINIO_ROOT_PASSWORD" ]] || fail "database and MinIO root secrets must not be reused"
[[ "$POSTGRES_PASSWORD" != "$S3_SECRET_ACCESS_KEY" ]] || fail "database and S3 application secrets must not be reused"
[[ "$MINIO_ROOT_PASSWORD" != "$S3_SECRET_ACCESS_KEY" ]] || fail "MinIO root and S3 application secrets must be different"
[[ "$MINIO_ROOT_USER" != "$S3_ACCESS_KEY_ID" ]] || fail "MinIO root and application access-key identities must be different"

if [[ "${SILONR_PREFLIGHT_ALLOW_TEST_VALUES:-false}" != "true" ]]; then
  combined="$SILONR_DOMAIN $SILONR_FILES_DOMAIN $POSTGRES_PASSWORD $BETTER_AUTH_SECRET $MINIO_ROOT_PASSWORD $S3_SECRET_ACCESS_KEY"
  shopt -s nocasematch
  [[ ! "$combined" =~ CHANGE_ME|example\.com|\.invalid|not-for-production|password123 ]] || \
    fail "placeholder/test values are forbidden for a real pilot"
  shopt -u nocasematch
fi

compose_files=(-f docker-compose.pilot.yml)
if [[ -n "${SILONR_COMPOSE_OVERRIDE:-}" ]]; then
  compose_files+=(-f "$SILONR_COMPOSE_OVERRIDE")
fi

docker compose "${compose_files[@]}" config --quiet

COMPOSE_FILES="${compose_files[*]}" python3 <<'PY'
import json
import os
import shlex
import subprocess
import sys

args = shlex.split(os.environ["COMPOSE_FILES"])
raw = subprocess.check_output(["docker", "compose", *args, "config", "--format", "json"], text=True)
model = json.loads(raw)
services = model.get("services", {})
networks = model.get("networks", {})

for name in ("postgres", "minio", "app"):
    ports = services.get(name, {}).get("ports") or []
    if ports:
        raise SystemExit(f"[pilot-preflight] ERROR: {name} must not publish host ports in the real pilot compose")

backend = networks.get("backend", {})
if not backend.get("internal"):
    raise SystemExit("[pilot-preflight] ERROR: backend network must remain internal")

postgres_networks = services.get("postgres", {}).get("networks") or {}
if set(postgres_networks) != {"backend"}:
    raise SystemExit("[pilot-preflight] ERROR: postgres must be reachable only through the internal backend network")

for name in ("app", "migrate"):
    env = services.get(name, {}).get("environment") or {}
    if str(env.get("NODE_ENV", "")) != "production":
        raise SystemExit(f"[pilot-preflight] ERROR: {name} NODE_ENV must be production")
    if str(env.get("VITE_ENABLE_DEMO", "")).lower() != "false":
        raise SystemExit(f"[pilot-preflight] ERROR: {name} must keep demo mode disabled")
    if str(env.get("ALLOW_PUBLIC_SIGNUP", "")).lower() != "false":
        raise SystemExit(f"[pilot-preflight] ERROR: {name} must keep public signup disabled")

print("[pilot-preflight] compose exposure and production-mode checks passed")
PY

info "PASS: pilot configuration passed structural and secret-separation checks"
