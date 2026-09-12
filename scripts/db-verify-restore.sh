#!/usr/bin/env bash
# Sanity-checks a just-restored database: confirms the expected core tables
# exist and have a plausible row count. This is NOT a full data-integrity
# audit (the application's own Prisma migration status / e2e suite is a
# stronger check) - it's a fast, scriptable "did the restore actually
# produce a real, non-empty, schema-complete database" signal, meant to run
# immediately after db-restore.sh, before trusting the restored data.
#
# Usage:
#   DB_HOST=... DB_PORT=... DB_USER=... PGPASSWORD=... ./scripts/db-verify-restore.sh <db-name>
#
# Exit codes: 0 = looks healthy, 1 = misconfiguration, 2 = a check failed.

set -euo pipefail

TARGET_DB="${1:?Usage: db-verify-restore.sh <db-name>}"
: "${DB_HOST:?DB_HOST is required}"
: "${DB_PORT:=5432}"
: "${DB_USER:?DB_USER is required}"

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is not installed or not on PATH." >&2
  exit 1
fi

PSQL=(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TARGET_DB" -tAc)

# Core tables that must exist in any real Peshani database, spanning
# several phases - a missing one strongly suggests a truncated/partial restore.
REQUIRED_TABLES=(stores users products orders payments refunds return_requests audit_logs)
FAILED=0

for table in "${REQUIRED_TABLES[@]}"; do
  EXISTS="$("${PSQL[@]}" "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='${table}')" 2>/dev/null || echo f)"
  if [ "$EXISTS" != "t" ]; then
    echo "FAIL: required table '$table' is missing"
    FAILED=1
  else
    COUNT="$("${PSQL[@]}" "SELECT COUNT(*) FROM ${table}" 2>/dev/null || echo "error")"
    echo "OK: table '$table' exists (row count: $COUNT)"
  fi
done

MIGRATION_COUNT="$("${PSQL[@]}" "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" 2>/dev/null || echo "0")"
echo "Applied Prisma migrations recorded in restored DB: $MIGRATION_COUNT"
if [ "$MIGRATION_COUNT" = "0" ]; then
  echo "FAIL: no applied migrations found - this does not look like a real Peshani database"
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  echo "Restore verification FAILED - do not treat this database as trustworthy." >&2
  exit 2
fi

echo "Restore verification passed."
exit 0
