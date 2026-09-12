#!/usr/bin/env bash
# Creates a timestamped, compressed pg_dump of the Peshani database.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:5432/dbname ./scripts/db-backup.sh [destination-dir]
# or, individually:
#   DB_HOST=... DB_PORT=... DB_USER=... DB_NAME=... PGPASSWORD=... ./scripts/db-backup.sh [destination-dir]
#
# The password is NEVER accepted as a script argument or hardcoded here -
# only via the PGPASSWORD environment variable (pg_dump's own standard
# mechanism) or embedded in DATABASE_URL, both of which stay out of process
# listings/shell history the way a positional argument would not.
#
# Exit codes: 0 = success, 1 = misconfiguration, 2 = pg_dump failed.

set -euo pipefail

DEST_DIR="${1:-./backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ -n "${DATABASE_URL:-}" ]; then
  CONN_ARGS=("$DATABASE_URL")
else
  : "${DB_HOST:?DB_HOST is required when DATABASE_URL is not set}"
  : "${DB_PORT:=5432}"
  : "${DB_USER:?DB_USER is required when DATABASE_URL is not set}"
  : "${DB_NAME:?DB_NAME is required when DATABASE_URL is not set}"
  CONN_ARGS=(-h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME")
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump is not installed or not on PATH." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
OUT_FILE="$DEST_DIR/peshani-${TIMESTAMP}.dump"

echo "Backing up to: $OUT_FILE"
# -F c (custom format): compressed, and the ONLY format pg_restore can
# selectively restore from or parallelize - a plain SQL dump (-F p) is
# intentionally NOT used here since §6 requires a real restore procedure,
# not just an export.
if pg_dump "${CONN_ARGS[@]}" -F c -f "$OUT_FILE"; then
  SIZE="$(du -h "$OUT_FILE" | cut -f1)"
  echo "Backup complete: $OUT_FILE ($SIZE)"
  exit 0
else
  echo "ERROR: pg_dump failed - see output above." >&2
  rm -f "$OUT_FILE"
  exit 2
fi
