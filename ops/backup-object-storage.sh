#!/usr/bin/env bash
set -euo pipefail

: "${SILONR_PRIMARY_S3_URI:?Example: s3://silonr-private}"
: "${SILONR_BACKUP_S3_URI:?Use a different backup bucket/account, e.g. s3://silonr-backup-prod}"
command -v aws >/dev/null 2>&1 || { echo "AWS CLI v2 is required" >&2; exit 2; }

if [ "$SILONR_PRIMARY_S3_URI" = "$SILONR_BACKUP_S3_URI" ]; then
  echo "Primary and backup storage must not be the same URI." >&2
  exit 3
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${SILONR_BACKUP_S3_URI%/}/snapshots/$STAMP/"
AWS_ARGS=()
if [ -n "${SILONR_PRIMARY_S3_ENDPOINT:-}" ]; then
  AWS_ARGS+=(--endpoint-url "$SILONR_PRIMARY_S3_ENDPOINT")
fi

# This is an additive snapshot. It intentionally does not use --delete: an
# accidental deletion/compromise in the primary bucket must not immediately
# erase the backup copy.
aws "${AWS_ARGS[@]}" s3 sync "$SILONR_PRIMARY_S3_URI" "$DEST" \
  --only-show-errors \
  --no-progress

echo "Object-storage snapshot created at $DEST"
echo "Production should also enable bucket versioning/object lock where supported and use a separate backup credential/account."
