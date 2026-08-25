#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
HOST="$(hostname 2>/dev/null || echo unknown)"
mkdir -p "$BACKUP_DIR"
umask 077

command -v pg_dump >/dev/null 2>&1 || { echo "pg_dump is required" >&2; exit 2; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 2; }

TARGET="$BACKUP_DIR/silonr-$STAMP.dump"
TMP="$TARGET.partial"

cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  --file="$TMP"

pg_restore --list "$TMP" >/dev/null
mv "$TMP" "$TARGET"
chmod 600 "$TARGET"
sha256sum "$TARGET" > "$TARGET.sha256"
chmod 600 "$TARGET.sha256"

cat > "$TARGET.meta" <<EOF
created_at_utc=$STAMP
host=$HOST
format=postgres_custom
sha256_file=$(basename "$TARGET.sha256")
retention_days=$RETENTION_DAYS
EOF
chmod 600 "$TARGET.meta"

# Retention applies only to this local staging directory. Production backups must
# also be copied to a separate encrypted backup location/account before relying
# on this cleanup.
if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && [ "$RETENTION_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -type f \( -name 'silonr-*.dump' -o -name 'silonr-*.dump.sha256' -o -name 'silonr-*.dump.meta' \) \
    -mtime "+$RETENTION_DAYS" -delete
fi

printf '%s\n' "$TARGET"
