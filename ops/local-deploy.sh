#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${1:-$repo_dir/deploy/local/.env}"
compose=(docker compose --env-file "$env_file" -f "$repo_dir/docker-compose.local.yml")

"$repo_dir/scripts/local-preflight.sh" "$env_file"

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

"${compose[@]}" up -d --build --wait
"${compose[@]}" cp caddy:/data/caddy/pki/authorities/local/root.crt "$repo_dir/deploy/local/silonr-local-ca.crt"

ca="$repo_dir/deploy/local/silonr-local-ca.crt"
wait_for_url() {
  local url="$1"
  for _ in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 5 --cacert "$ca" --resolve "$SILONR_LOCAL_SERVER:443:$SILONR_LOCAL_BIND_IP" --resolve "$SILONR_LOCAL_SERVER:9443:$SILONR_LOCAL_BIND_IP" "$url" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "Endpoint não ficou disponível: $url" >&2
  return 1
}
wait_for_url "https://$SILONR_LOCAL_SERVER/api/health/live"
wait_for_url "https://$SILONR_LOCAL_SERVER/api/health/ready"
wait_for_url "https://$SILONR_LOCAL_SERVER:9443/minio/health/live"

echo "SiloNR local disponível em https://$SILONR_LOCAL_SERVER"
echo "Instale o certificado deploy/local/silonr-local-ca.crt apenas nos PCs autorizados."
