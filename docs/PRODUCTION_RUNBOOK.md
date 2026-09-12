# Peshani Production Runbook

This is the operational reference for deploying, monitoring, and recovering
the Peshani platform in production. It assumes familiarity with Docker
Compose and basic PostgreSQL administration.

## 1. Architecture

```
                         Internet
                            |
                    [reverse-proxy: nginx]
                    TLS termination, HSTS,
                    security headers, routing
                            |
        +-------------------+-------------------+
        |                   |                   |
   [web: Next.js]     [admin: nginx+SPA]   [api: NestJS]
   (customer store)   (admin dashboard)    (all business logic)
        |                                       |
        +-------------------+-------------------+
                            |
                     [postgres:16]
                            |
                  (persistent named volume)

   [redis] - OPTIONAL, not required by application code today
             (see §14 Redis)
```

Single-instance target: this runbook documents deploying exactly ONE `api`
instance. Multi-instance scaling is discussed as a documented future path in
§17 and is NOT implemented in this phase - see the Phase 14 report's Redis
Decision and Worker Architecture sections for why.

Only `reverse-proxy` is reachable from outside the Docker network. `postgres`
and `redis` are never published to the host in `docker-compose.prod.yml`.

## 2. Environment Isolation

**Never run production Compose against an existing development Compose
project or volume. Always verify the resolved Compose configuration and
volume names before first startup.**

This is not optional caution - it is the fix for a real incident. An early
version of this repository's `docker-compose.prod.yml` declared the same
Postgres/Redis volume keys as `docker-compose.yml` with no explicit
Docker-level name, and neither file declared its own Compose *project*
name. Docker Compose decides "is this service already running" by the
`(project, service-name)` pair, not by volume or container name - so both
files defaulted to the same project (the working directory's name) and the
same service name (`postgres`), and a plain `docker compose -f
docker-compose.prod.yml up` (no `-p` flag) caused Compose to recreate the
real, long-running development Postgres container in place. No data was
lost in that incident (the underlying volume was reused, not deleted), but
it was pure luck of the exact command used, not a property the system
guaranteed. This section documents the fix that makes it structurally
impossible, not just discouraged.

### How isolation is enforced

Every environment's Compose file now declares, explicitly, in its own file:

| | Compose project `name:` | Postgres volume | Redis volume | Network | Container names |
|---|---|---|---|---|---|
| **Development** (`docker-compose.yml`) | `peshani-dev` | `peshani-dev-postgres-data` | `peshani-dev-redis-data` | `peshani-dev-network` | `peshani-dev-postgres`, `peshani-dev-redis` |
| **Production** (`docker-compose.prod.yml`) | `peshani-prod` | `peshani-prod-postgres-data` | `peshani-prod-redis-data` | `peshani-prod-network` | `peshani-prod-postgres`, `peshani-prod-api`, `peshani-prod-web`, `peshani-prod-admin`, `peshani-prod-reverse-proxy` |
| **Smoke test** (`docker-compose.prod.yml` + `docker-compose.smoketest.yml`) | *(any, e.g. `peshani-smoketest`)* | `peshani-smoketest-postgres-data` | `peshani-smoketest-redis-data` | `peshani-smoketest-network` | `peshani-smoketest-postgres`, `peshani-smoketest-api`, ... |

Two layers make this safe, deliberately redundant:

1. **The top-level Compose project `name:`** in each file is fixed and
   different (`peshani-dev` vs `peshani-prod`). This is the primary fix -
   it is what actually controls Compose's service-identity tracking, and it
   holds regardless of the working directory name or whether an operator
   remembers `-p`/`COMPOSE_PROJECT_NAME`. (An earlier, incomplete attempt
   at this fix added only explicit volume/container `name:` overrides
   without this - confirmed via a real, repeated test to be insufficient
   on its own, because Compose still matched the `postgres` service by
   project+service-name before ever looking at those overrides.)
2. **Explicit Docker-level `name:` overrides** on every persistent volume
   and the network, plus explicit `container_name:` on every service, so
   that even a `docker inspect`/`docker volume ls` glance at a running
   system immediately shows which environment a given object belongs to -
   no object in any of these files uses a bare, generic name like
   `postgres_data`.

`apps/api/test/phase14r1-environment-isolation.e2e-spec.ts` asserts all of
the above statically (parsing the Compose files directly, no Docker
required) and fails if a future edit ever lets two environments' volume,
network, or container names collide, or reintroduces a bare/generic name.

### Why a separate smoke-test override file

`docker-compose.prod.yml`'s volume/network/container names are hard-coded
via Docker-level `name:` overrides specifically so production is safe
regardless of Compose project name. That same hard-coding means reusing
`docker-compose.prod.yml` directly for a "smoke test" - even under a
different `-p` value - would still resolve to the exact same
`peshani-prod-*` names, and could collide with a real production
deployment if ever run against the same Docker host. `docker-compose.smoketest.yml`
is a Compose *override* file that replaces every persistent name with a
distinct `peshani-smoketest-*` identity. Always layer it on top of the
production file for smoke testing - never invoke `docker-compose.prod.yml`
alone for anything other than a real deployment.

### Safe commands

```bash
# Production deployment (project name is enforced by the file itself -
# a `-p` flag is not required for safety, though `-p peshani-prod` is fine
# and produces identical results):
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Always verify BEFORE first startup on a new host:
docker compose -f docker-compose.prod.yml --env-file .env.production config --volumes
# Expect exactly: peshani-prod-postgres-data, peshani-prod-api-storage
# (and peshani-prod-redis-data only if --profile with-redis is added)

# Smoke testing (never the production file alone):
docker compose \
  -f docker-compose.prod.yml -f docker-compose.smoketest.yml \
  --env-file .env.production \
  -p peshani-smoketest \
  up -d --build

# Always verify BEFORE first startup that the smoke-test config resolves
# to smoketest-named volumes, never prod-named or dev-named ones:
docker compose -f docker-compose.prod.yml -f docker-compose.smoketest.yml \
  --env-file .env.production config --volumes
# Expect exactly: peshani-smoketest-postgres-data, peshani-smoketest-api-storage

# Tearing down a smoke test removes ONLY its own throwaway volumes:
docker compose -f docker-compose.prod.yml -f docker-compose.smoketest.yml \
  -p peshani-smoketest down -v
```

Never run `docker compose -f docker-compose.prod.yml up` using a
`.env.production` that points `NEXT_PUBLIC_API_BASE_URL`, `CORS_ORIGINS`,
`RAZORPAY_*`, or `JWT_ACCESS_SECRET` at real production values from a
smoke-test invocation, and never point a real production `.env.production`
at a smoke-test/staging domain.

## 3. Environment Variables

See `apps/api/.env.example` (full reference, every variable documented) and
`.env.production.example` (the consolidated file `docker-compose.prod.yml`
actually consumes). Never commit a real `.env.production` - it is gitignored.

Key production-only requirements (enforced at API startup - see §22 Config
Validation):

| Variable | Requirement |
|---|---|
| `DATABASE_URL` | always required |
| `JWT_ACCESS_SECRET` | required, ≥32 chars, must not be a known dev placeholder |
| `CORS_ORIGINS` | required (non-empty) in production |
| `RAZORPAY_KEY_ID`/`_KEY_SECRET`/`_WEBHOOK_SECRET` | required in production, must not be a known dev placeholder |
| `TRUST_PROXY` | not enforced, but a startup WARNING is logged if unset in production (see §9) |
| `EMAIL_HOST`/`_USERNAME`/`_PASSWORD` | required only if `EMAIL_ENABLED=true` |
| `STORAGE_S3_*` | required only if `STORAGE_PROVIDER=s3` (not yet implemented - see §13) |

## 4. Secret Requirements

Never commit real secrets. In order of preference for a real deployment:
1. A managed secret store (cloud provider secrets manager, HashiCorp Vault,
   or your orchestrator's native secret objects) injected as environment
   variables at container start.
2. A `.env.production` file with restrictive filesystem permissions (`chmod
   600`), outside version control, on the host running Compose - the
   baseline this runbook assumes, since no secret manager is set up in this
   repo today.

Required real secrets before launch: `JWT_ACCESS_SECRET` (`openssl rand -hex
32`), `DB_PASSWORD`, `RAZORPAY_KEY_ID`/`_KEY_SECRET`/`_WEBHOOK_SECRET` (live
mode, from the Razorpay dashboard), `EMAIL_PASSWORD` (if email is enabled).

## 5. Build Process

```bash
# From the repo root:
docker build -f apps/api/Dockerfile   -t peshani-api:<tag>   .
docker build -f apps/web/Dockerfile   -t peshani-web:<tag>   \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://your-domain/api/v1 \
  --build-arg NEXT_PUBLIC_SITE_URL=https://your-domain .
docker build -f apps/admin/Dockerfile -t peshani-admin:<tag> \
  --build-arg VITE_API_BASE_URL=https://your-domain/api/v1 .
```

`NEXT_PUBLIC_*`/`VITE_*` values are baked into the client bundle at BUILD
time (not read at container startup) - get these right before building, a
running container cannot have them changed without a rebuild.

Each Dockerfile is a multi-stage build (deps → build → runtime), runs as a
non-root user, has a `HEALTHCHECK`, and never `ts-node`/dev servers in the
final image - verified by actually building and running all three images
against this repo's real dev database (see the Phase 14 report §31/§32).

## 6. Docker Deployment

```bash
cp .env.production.example .env.production   # then fill in real values
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml ps    # confirm all services healthy
```

To include Redis (only if a future multi-instance deployment needs it - see
§14): add `--profile with-redis`.

## 7. Database Migration

**Always** `prisma migrate deploy` in production - never `prisma migrate dev`
(interactive, dev-only) and never `prisma db push` (schema-only, bypasses
the migration history entirely, unsafe for production).

```bash
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec api npx prisma migrate status
```

Run this AFTER taking a backup (§7) and BEFORE routing production traffic to
a new image version. Migrations in this repo are purely additive by
convention (see §23 Migration Strategy) - no migration in `prisma/migrations/`
drops a column/table that existing running code still reads, which is what
makes a rolling deploy (old code + new schema, briefly) safe.

## 8. Backup

```bash
# Real values, not the placeholders below, in production:
DATABASE_URL=postgresql://user:pass@host:5432/peshani ./scripts/db-backup.sh /path/to/backup/dir
```

Uses `pg_dump -F c` (custom format - compressed, selectively restorable).
Never accepts a password as a positional argument - only via `PGPASSWORD`
or embedded in `DATABASE_URL`. Exits non-zero on failure (see the script's
own exit-code documentation).

**Recommendation**: run daily via a scheduled job (cron/systemd
timer/orchestrator CronJob) outside the application containers, writing to
a location backed up off-host (see §8).

## 9. Restore

```bash
DB_HOST=... DB_PORT=5432 DB_USER=... PGPASSWORD=... \
  ./scripts/db-restore.sh /path/to/backup.dump peshani_restored
DB_HOST=... DB_PORT=5432 DB_USER=... PGPASSWORD=... \
  ./scripts/db-verify-restore.sh peshani_restored
```

By default restores into a **new** database name - never overwrites a live
database unless `--drop-existing` is explicitly passed. `db-verify-restore.sh`
confirms core tables exist with real row counts and that `_prisma_migrations`
shows applied migrations - a restore is not considered valid until this
passes.

**This procedure was actually executed during Phase 14** against this
project's own real accumulated dev database (not a synthetic sample): a
32.8 MB backup was taken, restored into a throwaway `peshani_restore_test`
database, and verified (1,699 stores; 20,474 users; 18,971 products; 11,700
orders; 11,311 payments; 389 refunds; 1,244 return requests; 179,129 audit
log rows; 19 applied migrations - all present and correct), then the
throwaway database was dropped. This is real, executed evidence, not a
theoretical claim.

**RPO/RTO recommendation** (operational targets, not a guaranteed SLA):
- RPO (Recovery Point Objective): ≤24 hours with daily backups; reduce by
  increasing backup frequency if the business needs tighter data-loss
  tolerance.
- RTO (Recovery Time Objective): the restore itself took well under a
  minute for this dev dataset's size; budget more for a larger production
  dataset and add time for redeploying application containers and
  re-verifying readiness.

**Retention**: keep at least 7 daily + 4 weekly + 3 monthly backups as a
starting baseline; adjust to your actual compliance/business requirements.
**Off-site/encryption**: store backups in a location physically/logically
separate from the production database host, encrypted at rest - this repo
does not implement an off-site upload step; wire your backup destination's
own encryption-at-rest (e.g. an encrypted bucket) rather than relying on the
dump file itself being encrypted.

## 10. Health Checks

- `GET /api/v1/health/live` - liveness. Never touches the database. A load
  balancer/orchestrator should use this to decide "restart this container",
  never anything DB-dependent (a transient DB blip must not cause a restart
  storm).
- `GET /api/v1/health/ready` - readiness. Runs a real `SELECT 1`. Use this to
  decide "route traffic here" - remove an instance from rotation when this
  fails, without restarting it.
- `GET /api/v1/health` - legacy alias of `/health/ready`, kept for backward
  compatibility with existing tooling/tests.

None of the three ever return a database hostname, connection string, or
stack trace - confirmed by both code review and live testing.

**Important, verified behavior**: if PostgreSQL is unreachable when the API
container FIRST starts (not after), `PrismaService.onModuleInit()` throws
and the whole process exits before `app.listen()` ever runs - `/health/live`
is not reachable at all in that specific case (this was confirmed by
actually running a container against a deliberately-wrong `DATABASE_URL`).
This is why `docker-compose.prod.yml`'s `api` service declares `depends_on:
postgres: condition: service_healthy` - Compose will not even start the API
container until Postgres's own healthcheck passes. Once already running,
a LATER database outage is exactly what `/health/ready` failing (while
`/health/live` keeps succeeding) is designed to detect.

## 11. Monitoring

No specific SaaS vendor is required or assumed. Connect what already exists:

- **Logs**: every request/security/worker event is one structured JSON line
  on stdout (Phase 13). Any log driver/aggregator that ingests container
  stdout (Docker's own `json-file`/`local` driver, a `docker logs` tail, a
  Fluentd/Vector/Promtail sidecar, CloudWatch Logs, etc.) works without any
  code change.
- **Metrics**: `GET /admin/diagnostics` (permission-gated, `diagnostics.read`)
  returns a JSON snapshot of `MetricsService`'s in-process counters
  (`http_requests_total`, `http_request_errors_total`,
  `http_request_duration_ms`, `payment_failures_total`,
  `refund_failures_total`, `refund_unknown_total`, `webhook_failures_total`,
  `outbox_failed_total`, `email_delivery_failed_total`,
  `security_events_total`) plus outbox/notification backlog depth and age.
  A scraper can poll this endpoint and forward to Prometheus/Grafana/a cloud
  monitoring product, or you can parse the same fields directly out of the
  structured request logs.
- **Infrastructure** (CPU/memory/disk/container restarts): use your
  container platform's own facilities (`docker stats`, cAdvisor, your cloud
  provider's container metrics) - nothing in this application needs to
  report these itself.

Suggested alert conditions (thresholds are starting points, tune to real
traffic): `http_request_errors_total` rate spike, `refund_unknown_total` any
non-zero growth (should be rare and always investigated), repeated
`LOGIN_FAILURE`/`REFRESH_REUSE_DETECTED` security events, `outbox_failed_total`
or `email_delivery_failed_total` growth, container restart loops, disk usage
on the Postgres volume.

## 12. Logging

Structured JSON to stdout/stderr only (Phase 13's `StructuredLogger`) - no
container-local log files to manage or lose on restart. Never logs
passwords/tokens/API keys/Authorization headers/payment secrets/SMTP
passwords - verified in Phase 13's audit and again in this phase's log
review of every new call site added.

## 13. Worker Operations

`OutboxWorkerService` and `EmailDeliveryWorkerService` both poll every
second (`processBatchOnce()`) via an atomic conditional claim (`updateMany`
with a status guard), so **it is always safe to run them in exactly one
process today** (single-instance target) with zero duplicate-processing
risk even if you temporarily ran two by accident. For a future
multi-instance deployment, set `ENABLE_WORKERS=false` on every instance
except one designated worker instance (see the Phase 14 report's Worker
Architecture section for the full rationale). Both workers:
- recover their own stale-`PROCESSING` rows (a crash mid-batch) after a
  5-minute threshold, automatically, on their next tick;
- stop cleanly on SIGTERM/SIGINT via the graceful-shutdown handler (§13);
- expose backlog depth/age and failure counts via `/admin/diagnostics`.

## 14. Media Storage

`STORAGE_PROVIDER=local` (the only implemented provider) writes uploaded
files under `STORAGE_LOCAL_ROOT`, mounted as the `peshani_api_storage` named
Docker volume in `docker-compose.prod.yml` - this **persists across
container restarts/redeploys on the same host**. This is a single-instance-
safe strategy only: a second `api` replica on a different host would not
see the first replica's uploads, since a named volume is local to the
Docker host it lives on. `storage.module.ts` now fails loudly at startup if
`STORAGE_PROVIDER=s3` is set (no implementation exists yet) rather than
silently falling back to local - a real bug fixed in this phase. Adding a
real S3-compatible provider later is a contained change: implement
`StorageProvider` (see `storage-provider.interface.ts`) and add one
`if (provider === 's3')` branch to `storage.module.ts`'s factory - no other
code needs to change. Back up `peshani_api_storage` alongside the database
if uploaded media matters for your recovery objectives (this repo's backup
scripts cover only the database, not this volume - add a
`docker run --rm -v peshani_api_storage:/data -v $(pwd):/backup alpine tar
czf /backup/media-backup.tar.gz -C /data .`-style step if needed).

## 15. Redis

Provisioned in both `docker-compose.yml` (dev) and optionally in
`docker-compose.prod.yml` (behind the `with-redis` Compose profile, never
started by a plain `up`). **Nothing in the application runtime currently
uses Redis** - confirmed by code audit (no `ioredis`/`redis` client anywhere
in `apps/api/src`). This phase deliberately does NOT wire Redis into rate
limiting or anything else, per the explicit instruction not to add it
"just because it exists." If you later scale to multiple `api` instances,
you will need Redis-backed distributed rate limiting (`@nestjs/throttler`
supports a pluggable storage; a Redis-backed `ThrottlerStorage`
implementation would replace the default in-memory one) with fail-safe
behavior (never silently allow unlimited access if Redis is unreachable -
fail closed to the existing in-memory limit as a fallback, not fail open).
This is documented as a Phase 14-identified future requirement, not
implemented here.

## 16. Reverse Proxy

`deploy/nginx/nginx.conf` - HTTP→HTTPS redirect, TLS termination, HSTS,
baseline security headers, `client_max_body_size 12m` (matches
`MEDIA_MAX_UPLOAD_BYTES`'s 10 MB default plus multipart overhead - keep in
sync if that env var is raised), and path-based routing to `api`/`web`/
`admin`. PostgreSQL and Redis are never routed through or exposed by this
proxy.

## 17. TLS

Certificates are bind-mounted from `deploy/nginx/certs/` (gitignored) - NEVER
committed. Two supported approaches:
1. **certbot/Let's Encrypt** on the host: obtain via the HTTP-01 challenge
   (the `/.well-known/acme-challenge/` location in `nginx.conf` is already
   routed for this), place `fullchain.pem`/`privkey.pem` in
   `deploy/nginx/certs/`, and set up a renewal cron (`certbot renew`) plus an
   `nginx -s reload` after renewal.
2. **A managed load balancer/CDN in front of this stack** terminates TLS
   itself - in that topology, remove the `443 ssl` server block from
   `nginx.conf` and let the proxy answer plain HTTP internally, with the LB
   forwarding `X-Forwarded-Proto: https` (and `TRUST_PROXY` on the API
   configured to trust that hop).

## 18. Scaling

This runbook's default: **one `api` instance**. Scaling `web`/`admin`
horizontally is straightforward (they are stateless) - just add more
replicas behind nginx's upstream blocks. Scaling `api` requires first
resolving: (a) distributed rate limiting (§14), (b) worker de-duplication
via `ENABLE_WORKERS` (§12), (c) shared/object media storage instead of a
local volume (§13). None of these are implemented in this phase - they are
documented, contained, well-understood future work, not silently ignored.

## 19. Rollback

```
Currently-running image (vN)
        |
   docker compose -f docker-compose.prod.yml stop api web admin
        |
   Deploy known-good image (vN-1): re-tag or re-pull, then
   docker compose -f docker-compose.prod.yml up -d api web admin
        |
   Verify readiness: curl https://<host>/api/v1/health/ready
        |
   Re-run smoke checks (§27 of the Phase 14 report / this runbook's own checklist)
```

Database rollback does **not** use automatic down-migrations (explicitly
disallowed - see §23 Migration Strategy). If a migration itself is the
problem, restore the pre-migration backup (§8) rather than attempting to
programmatically reverse a forward migration.

## 20. Disaster Recovery

| Failure | Automatic recovery | Manual/operator action |
|---|---|---|
| Database process crash | Compose `restart: unless-stopped` restarts the container | Verify data integrity post-restart; check for corruption if the crash was disk-related |
| Database data loss/corruption | None | Restore from the most recent verified backup (§8) |
| API crash | Compose `restart: unless-stopped`; graceful-shutdown logic (§13) minimizes mid-request data loss on a clean stop, not a crash | Check logs for the crash cause; if DB was unreachable at startup, confirm Postgres is healthy first (§9) |
| Worker stuck/hung | Stale-`PROCESSING` recovery (5 min threshold) self-heals on the next tick | If not resolved, restart the `api` container |
| Media storage volume failure | None (local volume is host-local) | Restore from your own media backup (§13) onto a fresh volume |
| Redis failure | N/A - nothing depends on it today | If it becomes a runtime dependency later (§14), it must degrade to a safe default, never fail open |
| Reverse proxy failure | Compose `restart: unless-stopped` | If nginx config itself is broken, roll back `deploy/nginx/nginx.conf` to the last-known-good version |
| Expired TLS certificate | None unless certbot auto-renewal is configured and working | Manually renew and reload nginx; monitor certificate expiry proactively (30-day-out alert recommended) |
| Corrupted deployment (bad image) | None | Roll back per §18 |
| Accidental configuration error | Startup validation (§22) blocks obviously-invalid production config from ever starting | Fix the offending environment variable and redeploy |

## 21. Troubleshooting

- **API won't start**: check `docker compose logs api` for the
  `Configuration validated:` / `Startup aborted - invalid configuration:`
  line first - most startup failures are a missing/placeholder env var,
  reported without ever printing the actual secret value.
- **`/health/ready` returns 503**: PostgreSQL is unreachable from the API
  container - check `docker compose ps postgres` and its own healthcheck.
- **Uploads failing**: check `MEDIA_MAX_UPLOAD_BYTES` vs the reverse proxy's
  `client_max_body_size` (§15) - these must stay in sync.
- **CORS errors in the browser**: confirm `CORS_ORIGINS` includes the exact
  scheme+host+port the browser is calling from.
- **Client IP / rate limiting looks wrong behind the proxy**: confirm
  `TRUST_PROXY` is set to match your actual proxy topology (§9 of the Phase
  14 report / `apps/api/.env.example`'s own documentation).

## 22. Security Checklist

See `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md`.

## 23. Pre-Launch Checklist

See `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md`.
