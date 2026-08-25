#!/usr/bin/env bash
set -euo pipefail

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Usage: $0 /path/to/silonr-YYYYMMDDTHHMMSSZ.dump" >&2
  exit 2
fi

command -v pg_restore >/dev/null 2>&1 || { echo "pg_restore is required" >&2; exit 2; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 2; }

if [ -f "$BACKUP_FILE.sha256" ]; then
  (cd "$(dirname "$BACKUP_FILE")" && sha256sum --check "$(basename "$BACKUP_FILE").sha256")
else
  echo "Warning: checksum file missing; validating archive structure only." >&2
fi

ITEMS="$(pg_restore --list "$BACKUP_FILE" | grep -Ev '^;' | wc -l | tr -d ' ')"
if [ "$ITEMS" -lt 1 ]; then
  echo "Backup archive contains no restorable items." >&2
  exit 1
fi

echo "Backup verified: $ITEMS restorable items."
