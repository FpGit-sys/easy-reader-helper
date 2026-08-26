#!/usr/bin/env bash
set -euo pipefail
[[ "${LOCAL_RESTORE_CONFIRM:-}" == "RESTORE_SILONR_LOCAL" ]] || { echo "Defina LOCAL_RESTORE_CONFIRM=RESTORE_SILONR_LOCAL." >&2; exit 1; }
bundle="${1:?informe o diretório do backup}"
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${2:-$repo_dir/deploy/local/.env}"
[[ -f "$bundle/manifest.txt" && -f "$bundle/database.dump" && -f "$bundle/SHA256SUMS" ]] || { echo "Pacote de backup incompleto." >&2; exit 1; }
(cd "$bundle" && sha256sum --check SHA256SUMS)
docker run --rm -v "$bundle:/backup:ro" postgres:16-alpine pg_restore --list /backup/database.dump >/dev/null
"$repo_dir/scripts/local-preflight.sh" "$env_file"
set -a
source "$env_file"
set +a
compose=(docker compose --env-file "$env_file" -f "$repo_dir/docker-compose.local.yml")
"${compose[@]}" stop app
"${compose[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists \"$POSTGRES_DB\" with (force)" -c "create database \"$POSTGRES_DB\" owner \"$POSTGRES_USER\""
"${compose[@]}" exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error <"$bundle/database.dump"
"${compose[@]}" run --rm --no-deps --entrypoint /bin/sh -v "$bundle/objects:/backup:ro" create-bucket -ec '
  mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  mc rm --recursive --force "local/$S3_BUCKET"
  mc mirror --overwrite /backup "local/$S3_BUCKET"
'
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --wait app caddy
echo "Restauração concluída e serviços saudáveis."
