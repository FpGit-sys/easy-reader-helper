#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${SILONR_ENV_FILE:-$repo_root/deploy/pilot/.env}"
[[ -f "$env_file" ]] || { echo "[pilot-restore] missing $env_file" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

backup_dir="${PILOT_BACKUP_DIR:-/var/backups/silonr}"
archive="${1:-$(find "$backup_dir/postgres" -maxdepth 1 -type f -name 'silonr-*.dump' -printf '%T@ %p
' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-)}"
[[ -n "$archive" && -s "$archive" ]] || { echo "[pilot-restore] no local backup archive found" >&2; exit 1; }
[[ -s "$archive.sha256" ]] || { echo "[pilot-restore] checksum missing" >&2; exit 1; }
(cd "$(dirname "$archive")" && sha256sum --check "$(basename "$archive").sha256")

container="silonr-restore-drill-$$"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$container"   -e POSTGRES_USER=restore -e POSTGRES_PASSWORD=restore-only-ephemeral   -e POSTGRES_DB=silonr_restore postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$container" pg_isready -U restore -d silonr_restore >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$container" pg_isready -U restore -d silonr_restore >/dev/null

docker cp "$archive" "$container:/tmp/restore.dump"
docker exec "$container" pg_restore   --username restore --dbname silonr_restore --no-owner --no-privileges   --exit-on-error /tmp/restore.dump >/dev/null

table_count="$(docker exec "$container" psql -U restore -d silonr_restore -Atqc   "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
[[ "$table_count" =~ ^[0-9]+$ && "$table_count" -ge 20 ]] || {
  echo "[pilot-restore] expected at least 20 public tables, got $table_count" >&2
  exit 1
}

mkdir -p "$backup_dir/evidence"
evidence="$backup_dir/evidence/restore-drill-$timestamp.txt"
{
  echo "status=PASS"
  echo "tested_at=$timestamp"
  echo "archive=$archive"
  echo "public_table_count=$table_count"
  echo "target=isolated_ephemeral_postgres_16"
} >"$evidence"
echo "[pilot-restore] PASS: restored $table_count public tables; evidence: $evidence"
