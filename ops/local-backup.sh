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
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle="$LOCAL_BACKUP_DIR/$timestamp"
mkdir -p "$bundle/objects"
"${compose[@]}" exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc >"$bundle/database.dump"
docker run --rm -v "$bundle:/backup:ro" postgres:16-alpine pg_restore --list /backup/database.dump >/dev/null
"${compose[@]}" run --rm --no-deps --entrypoint /bin/sh -v "$bundle/objects:/backup" create-bucket -ec '
  mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  mc mirror --overwrite --remove "local/$S3_BUCKET" /backup
'
(
  cd "$bundle"
  sha256sum database.dump >SHA256SUMS
  find objects -type f -print0 | sort -z | xargs -0 -r sha256sum >>SHA256SUMS
)
cat >"$bundle/manifest.txt" <<EOF
format=silonr-local-backup-v1
created_at=$timestamp
database=$POSTGRES_DB
bucket=$S3_BUCKET
EOF
find "$LOCAL_BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+${LOCAL_BACKUP_RETENTION_DAYS:-30}" -print -exec rm -rf -- {} +
echo "Backup verificado criado em $bundle"
