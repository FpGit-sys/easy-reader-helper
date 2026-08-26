#!/usr/bin/env bash
set -euo pipefail

BACKUP_FILE="${1:-}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required and must point to the restore target}"

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Usage: RESTORE_DATABASE_URL=... RESTORE_CONFIRM=RESTORE_SILONR $0 /path/to/backup.dump" >&2
  exit 2
fi
if [ "${RESTORE_CONFIRM:-}" != "RESTORE_SILONR" ]; then
  echo "Refusing restore. Set RESTORE_CONFIRM=RESTORE_SILONR after verifying the target database." >&2
  exit 3
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$SCRIPT_DIR/verify-postgres-backup.sh" "$BACKUP_FILE"

command -v pg_restore >/dev/null 2>&1 || { echo "pg_restore is required" >&2; exit 2; }

# The target database must exist. --clean removes objects represented by the
# archive; --if-exists avoids noisy failures for a new empty restore database.
pg_restore \
  --dbname="$RESTORE_DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "$BACKUP_FILE"

echo "Restore completed. Run application migrations and the smoke-test checklist before promoting this database."
