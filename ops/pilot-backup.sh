#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${SILONR_ENV_FILE:-$repo_root/deploy/pilot/.env}"
compose=(docker compose --env-file "$env_file" -f "$repo_root/docker-compose.pilot.yml")

[[ -f "$env_file" ]] || { echo "[pilot-backup] missing $env_file" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

backup_dir="${PILOT_BACKUP_DIR:-/var/backups/silonr}"
retention_days="${PILOT_BACKUP_RETENTION_DAYS:-30}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$backup_dir/postgres/silonr-$timestamp.dump"
metadata="$archive.meta"
mkdir -p "$backup_dir/postgres" "$backup_dir/evidence"

"${compose[@]}" exec -T postgres pg_dump   --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"   --format=custom --no-owner --no-privileges >"$archive"
[[ -s "$archive" ]] || { echo "[pilot-backup] empty PostgreSQL archive" >&2; exit 1; }

docker run --rm -v "$backup_dir/postgres:/backup:ro" postgres:16-alpine   pg_restore --list "/backup/$(basename "$archive")" >/dev/null
sha256sum "$archive" >"$archive.sha256"
{
  echo "created_at=$timestamp"
  echo "source_project=${COMPOSE_PROJECT_NAME:-silonr-pilot}"
  echo "postgres_database=$POSTGRES_DB"
  echo "archive_sha256=$(sha256sum "$archive" | awk '{print $1}')"
} >"$metadata"

export PILOT_BACKUP_SNAPSHOT="$timestamp"
export PILOT_BACKUP_ARCHIVE="$(basename "$archive")"
"${compose[@]}" run --rm --no-deps   -v "$backup_dir/postgres:/backup:ro"   -e PILOT_BACKUP_SNAPSHOT -e PILOT_BACKUP_ARCHIVE   -e PILOT_BACKUP_S3_ENDPOINT -e PILOT_BACKUP_S3_ACCESS_KEY_ID   -e PILOT_BACKUP_S3_SECRET_ACCESS_KEY -e PILOT_BACKUP_S3_BUCKET   -e PILOT_BACKUP_PREFIX -e S3_BUCKET   --entrypoint /bin/sh create-bucket -c '
    set -eu
    mc alias set primary http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" >/dev/null
    mc alias set backup "$PILOT_BACKUP_S3_ENDPOINT" "$PILOT_BACKUP_S3_ACCESS_KEY_ID" "$PILOT_BACKUP_S3_SECRET_ACCESS_KEY" >/dev/null
    target="backup/$PILOT_BACKUP_S3_BUCKET/$PILOT_BACKUP_PREFIX/$PILOT_BACKUP_SNAPSHOT"
    mc cp "/backup/$PILOT_BACKUP_ARCHIVE" "$target/postgres/$PILOT_BACKUP_ARCHIVE" >/dev/null
    mc cp "/backup/$PILOT_BACKUP_ARCHIVE.sha256" "$target/postgres/$PILOT_BACKUP_ARCHIVE.sha256" >/dev/null
    mc cp "/backup/$PILOT_BACKUP_ARCHIVE.meta" "$target/postgres/$PILOT_BACKUP_ARCHIVE.meta" >/dev/null
    mc mirror --overwrite "primary/$S3_BUCKET" "$target/objects" >/dev/null
    mc stat "$target/postgres/$PILOT_BACKUP_ARCHIVE" >/dev/null
  '

find "$backup_dir/postgres" -type f -mtime "+$retention_days" -delete
evidence="$backup_dir/evidence/backup-$timestamp.txt"
{
  echo "status=PASS"
  echo "created_at=$timestamp"
  echo "archive=$archive"
  echo "external=s3://$PILOT_BACKUP_S3_BUCKET/$PILOT_BACKUP_PREFIX/$timestamp"
} >"$evidence"
echo "[pilot-backup] PASS: $archive and external object snapshot verified"
