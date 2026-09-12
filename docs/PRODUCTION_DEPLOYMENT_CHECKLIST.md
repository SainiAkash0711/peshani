# Peshani Production Deployment Checklist

Work through every section in order. Do not skip Database/Backup items -
they must be verified BEFORE the first production migration runs, not
after something goes wrong. See `docs/PRODUCTION_RUNBOOK.md` for the
detailed explanation behind each item.

## Environment Isolation

- [ ] Confirmed `docker-compose.prod.yml` declares its own top-level
      `name: peshani-prod` (never removed or renamed)
- [ ] Ran `docker compose -f docker-compose.prod.yml --env-file
      .env.production config --volumes` and confirmed the output is
      exactly `peshani-prod-postgres-data` / `peshani-prod-api-storage`
      (plus `peshani-prod-redis-data` only if `--profile with-redis` is
      used) - **never** a bare/generic name, and never a `peshani-dev-*`
      or `peshani-smoketest-*` name
- [ ] Confirmed via `docker volume ls` on the target host that no volume
      named `peshani-prod-*` already exists from a previous, unrelated
      deployment before the first-ever production `up`
- [ ] If a smoke test is run on the same host first, confirmed it used
      `docker-compose.smoketest.yml` layered on top of the production
      file (never the production file alone) and that its resolved
      volumes are `peshani-smoketest-*`, never `peshani-prod-*`
- [ ] `npx jest --config apps/api/test/jest-e2e.json
      apps/api/test/phase14r1-environment-isolation.e2e-spec.ts` passes
      (statically verifies dev/prod/smoke-test volume, network, and
      container names can never collide)
- [ ] Never run production Compose against an existing development
      Compose project or volume - see `docs/PRODUCTION_RUNBOOK.md`'s
      "Environment Isolation" section for the full safe-command reference

## Infrastructure

- [ ] Docker Engine + Compose v2 (`docker compose version`) installed on the
      target host
- [ ] `peshani-api`, `peshani-web`, `peshani-admin` images built with real
      production build args (`NEXT_PUBLIC_API_BASE_URL`,
      `NEXT_PUBLIC_SITE_URL`, `VITE_API_BASE_URL` all pointing at the real
      public domain, not localhost)
- [ ] `.env.production` created from `.env.production.example`, filled with
      real values, `chmod 600`, NOT committed to version control
- [ ] `deploy/nginx/certs/fullchain.pem` and `privkey.pem` present (real
      certificate, e.g. from certbot) - `deploy/nginx/certs/` must never
      contain a committed real certificate in the repo itself
- [ ] Named volumes (`peshani_postgres_data`, `peshani_api_storage`)
      confirmed present and NOT accidentally recreated (would silently
      wipe data) on redeploy
- [ ] Resource limits in `docker-compose.prod.yml` reviewed against the
      target host's actual CPU/memory
- [ ] Redis left disabled (no `--profile with-redis`) unless a specific,
      already-implemented feature requires it (none do as of Phase 14 -
      see the runbook's Redis section)

## Security

- [ ] `JWT_ACCESS_SECRET` is a real random value (`openssl rand -hex 32`),
      not a placeholder from `.env.example`
- [ ] `RAZORPAY_KEY_ID`/`_KEY_SECRET`/`_WEBHOOK_SECRET` are real live-mode
      values, not `rzp_test_placeholder` or similar
- [ ] `CORS_ORIGINS` lists only the real production origin(s) - never `*`
      and never a dev localhost origin
- [ ] `TRUST_PROXY` set correctly for the actual topology (`1` for exactly
      one reverse proxy hop, per `docker-compose.prod.yml`'s nginx-in-front
      topology)
- [ ] Confirmed via `docker compose config` (or by grepping the rendered
      compose file) that no service publishes `postgres`'s or `redis`'s
      port to the host - only `reverse-proxy` publishes 80/443
- [ ] Ran `node dist/main.js` once locally with a deliberately-invalid env
      var to confirm the config validator (§22 of the runbook) rejects it
      and never prints the secret value
- [ ] `npm audit` run on each workspace and findings triaged (see the Phase
      14 report's Dependency Audit section) - no known-exploitable HIGH/
      CRITICAL vulnerability in a production code path left un-triaged
- [ ] Verified no `.env*` file (other than `.env.example`) is present in any
      built Docker image (`docker run --rm <image> sh -c "find / -name
      '.env*' 2>/dev/null"` should return nothing but `.env.example` if
      present at all)

## Database

- [ ] Full backup taken (`scripts/db-backup.sh`) and its restore path
      actually tested (`scripts/db-restore.sh` + `db-verify-restore.sh`
      into a throwaway database) BEFORE running any migration against the
      real production database
- [ ] `npx prisma migrate status` run against production to confirm no
      migration is already partially applied / out of sync
- [ ] `npx prisma migrate deploy` run (never `migrate dev`, never `db push`)
- [ ] `npx prisma migrate status` re-run post-deploy to confirm clean state
- [ ] Confirmed the migration set contains no destructive/dropping
      operation that existing (pre-deploy) running code still depends on -
      required for a safe rolling deploy

## Application

- [ ] `docker compose -f docker-compose.prod.yml up -d --build` completed
      with all services reporting `healthy` (`docker compose ps`)
- [ ] `GET https://<domain>/api/v1/health/ready` returns 200
- [ ] `GET https://<domain>/api/v1/health/live` returns 200
- [ ] Storefront (`https://<domain>/`) loads and renders real product data
- [ ] Admin (`https://<domain>/admin/`) loads, and an admin login succeeds
- [ ] A real (or sandboxed live-mode) checkout completes end-to-end,
      including a real Razorpay webhook delivery reaching
      `/api/v1/payments/webhook`
- [ ] A file upload (e.g. a product image via the admin) succeeds and the
      uploaded file is retrievable afterward through the mounted storage
      volume
- [ ] Security headers present on all three surfaces (verify with `curl -I`
      against the real domain, not just in config): `Strict-Transport-
      Security`, `X-Content-Type-Options`, `X-Frame-Options`,
      `Referrer-Policy`, `Content-Security-Policy` - confirmed necessary in
      Phase 14 after finding a real nginx `add_header`-inheritance bug that
      silently dropped these on the admin SPA's root route; do not assume
      config correctness implies runtime correctness for this category of
      check

## Observability

- [ ] Confirmed container stdout is actually being captured by your log
      driver/aggregator (`docker compose logs -f api` shows structured JSON
      lines during real traffic)
- [ ] `GET /admin/diagnostics` (as a `diagnostics.read`-permitted admin
      user) returns a metrics snapshot with all expected counters present
      and no unbounded-cardinality labels (spot-check a few entries)
- [ ] Alerting wired for at least: error-rate spike, `refund_unknown_total`
      any growth, repeated authentication-failure security events, worker
      backlog growth, disk usage on the Postgres volume, container restart
      loops, TLS certificate expiry approaching
- [ ] Confirmed logs never contain a password/token/API key/Authorization
      header value (spot-check real production log output after the first
      hour of traffic, not just the test suite's static assertions)

## Operations

- [ ] `docker stop --time <SHUTDOWN_TIMEOUT_MS/1000>` (or an orchestrator
      equivalent SIGTERM) tested against a real running production-image
      container and confirmed to log a clean graceful-shutdown sequence and
      exit 0
- [ ] Rollback procedure (runbook §18) rehearsed at least once in a
      non-production environment before go-live
- [ ] On-call/escalation path defined for each Disaster Recovery scenario
      in the runbook's §19 table
- [ ] Backup schedule (cron/systemd timer/orchestrator CronJob) actually
      installed and its first scheduled run confirmed to have produced a
      new backup file
- [ ] Retention/off-site copy policy for backups implemented, not just
      planned
- [ ] Team has read `docs/PRODUCTION_RUNBOOK.md` in full, at least once,
      before this deployment goes live
