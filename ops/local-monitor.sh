#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${1:-$repo_dir/deploy/local/.env}"
"$repo_dir/scripts/local-preflight.sh" "$env_file"
set -a
source "$env_file"
set +a
compose=(docker compose --env-file "$env_file" -f "$repo_dir/docker-compose.local.yml")
ca="$repo_dir/deploy/local/silonr-local-ca.crt"
status_file="$LOCAL_BACKUP_DIR/monitor-status.json"
mkdir -p "$LOCAL_BACKUP_DIR"

fail() {
  printf '{"status":"fail","checkedAt":"%s","message":"%s"}\n' "$(date -u +%FT%TZ)" "$1" >"$status_file"
  echo "$1" >&2
  exit 1
}

[[ -f "$ca" ]] || fail "certificado local ausente"
for service in postgres minio app caddy; do
  "${compose[@]}" ps --status running --services | grep -qx "$service" || fail "container $service não está em execução"
done
curl --noproxy '*' --fail --silent --show-error --max-time 10 --cacert "$ca" --resolve "$SILONR_LOCAL_SERVER:443:$SILONR_LOCAL_BIND_IP" "https://$SILONR_LOCAL_SERVER/api/health/ready" >/dev/null || fail "aplicação não está pronta"
curl --noproxy '*' --fail --silent --show-error --max-time 10 --cacert "$ca" --resolve "$SILONR_LOCAL_SERVER:9443:$SILONR_LOCAL_BIND_IP" "https://$SILONR_LOCAL_SERVER:9443/minio/health/live" >/dev/null || fail "storage não está pronto"

used_percent="$(df -P "$LOCAL_BACKUP_DIR" | awk 'NR==2 {gsub("%","",$5); print $5}')"
[[ "$used_percent" =~ ^[0-9]+$ ]] || fail "não foi possível medir o disco"
(( used_percent < 90 )) || fail "disco com ${used_percent}% de uso"

printf '{"status":"ok","checkedAt":"%s","diskUsedPercent":%s}\n' "$(date -u +%FT%TZ)" "$used_percent" >"$status_file"
echo "Monitor local aprovado; disco em ${used_percent}%."
