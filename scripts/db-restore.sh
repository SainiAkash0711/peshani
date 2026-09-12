#!/usr/bin/env bash
# Restores a pg_dump custom-format backup (see db-backup.sh) into a target
# database. By DEFAULT this restores into a NEW/EMPTY database whose name
# you specify - it deliberately does NOT overwrite an existing database in
# place unless you explicitly pass --drop-existing, since restoring over a
# live database is destructive and must be a conscious choice, never an
# accidental default.
#
# Usage:
#   DB_HOST=... DB_PORT=... DB_USER=... PGPASSWORD=... \
#     ./scripts/db-restore.sh <backup-file> <target-db-name> [--drop-existing]
#
# Exit codes: 0 = success, 1 = misconfiguration, 2 = restore failed.

set -euo pipefail

BACKUP_FILE="${1:?Usage: db-restore.sh <backup-file> <target-db-name> [--drop-existing]}"
TARGET_DB="${2:?Usage: db-restore.sh <backup-file> <target-db-name> [--drop-existing]}"
DROP_EXISTING="${3:-}"

: "${DB_HOST:?DB_HOST is required}"
: "${DB_PORT:=5432}"
: "${DB_USER:?DB_USER is required}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

for cmd in pg_restore createdb dropdb psql; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required tool '$cmd' is not installed or not on PATH." >&2
    exit 1
  fi
done

EXISTS="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='${TARGET_DB}'")"

if [ "$EXISTS" = "1" ]; then
  if [ "$DROP_EXISTING" = "--drop-existing" ]; then
    echo "WARNING: dropping existing database '$TARGET_DB' (--drop-existing was passed)..."
    dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$TARGET_DB"
  else
    echo "ERROR: database '$TARGET_DB' already exists. Pass --drop-existing to replace it," \
         "or choose a different --target-db-name to restore alongside it." >&2
    exit 1
  fi
fi

echo "Creating database '$TARGET_DB'..."
createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$TARGET_DB"

echo "Restoring $BACKUP_FILE into '$TARGET_DB'..."
if pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TARGET_DB" --no-owner --no-privileges "$BACKUP_FILE"; then
  echo "Restore complete into database '$TARGET_DB'."
  echo "Run scripts/db-verify-restore.sh next to sanity-check the restored data before relying on it."
  exit 0
else
  echo "ERROR: pg_restore reported a failure - inspect the output above." \
       "Note: pg_restore commonly exits non-zero even on a substantially successful restore" \
       "if it hit non-fatal warnings (e.g. missing extensions/roles) - review carefully" \
       "rather than assuming total failure; scripts/db-verify-restore.sh helps disambiguate." >&2
  exit 2
fi
