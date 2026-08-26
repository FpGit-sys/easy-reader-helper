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
curl --fail --silent --show-error --cacert "$ca" "https://$SILONR_LOCAL_SERVER/api/health/live" >/dev/null
curl --fail --silent --show-error --cacert "$ca" "https://$SILONR_LOCAL_SERVER/api/health/ready" >/dev/null
curl --fail --silent --show-error --cacert "$ca" "https://$SILONR_LOCAL_SERVER:9443/minio/health/live" >/dev/null

echo "SiloNR local disponível em https://$SILONR_LOCAL_SERVER"
echo "Instale o certificado deploy/local/silonr-local-ca.crt apenas nos PCs autorizados."
