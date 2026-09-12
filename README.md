# Peshani

Professional ecommerce platform. This repository is being built in phases (see the roadmap below); **Phase 1 — Foundation & Auth** is implemented and verified.

## Stack

- **API:** NestJS (TypeScript), PostgreSQL via Prisma, Redis (reserved for later phases)
- **Storefront:** Next.js (React) — SSR for SEO-critical pages
- **Admin:** Vite + React SPA
- **Infra:** Docker Compose (Postgres, Redis), npm workspaces monorepo

## Repository layout

```
apps/
  api/     NestJS API (source of truth for all data; storefront/admin never touch the DB directly)
  web/     Next.js storefront
  admin/   Vite React admin panel
docker-compose.yml   Postgres + Redis for local development
```

## Phase 1 scope

Store configuration, users, roles/permissions (RBAC), authentication (register/login/refresh/logout,
email verification and password reset stubs), audit logging, and health checks. Every later phase
(catalog, cart, orders, payments, ...) builds its own modules on top of this foundation.

Store branding (name, description, currency, support contact, etc.) is **not hardcoded** — it's read
from the `StoreSetting` table via `GET /api/v1/store-settings`, which the storefront calls at render
time. Changing a row in that table changes the storefront without a code deploy.

## Getting started

```bash
# 1. Install dependencies (from repo root)
npm install

# 2. Configure environment
cp .env.example .env
# Generate a real secret for JWT_ACCESS_SECRET, e.g.:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Start Postgres + Redis
docker compose up -d

# 4. Run migrations and seed data (creates the Peshani store, permissions,
#    SUPER_ADMIN/CUSTOMER roles, and a seed admin user)
cd apps/api
npx prisma migrate dev
npx ts-node prisma/seed.ts

# 5. Run the API
npm run start:dev   # http://localhost:4000/api/v1, Swagger at /api/docs

# 6. Run the storefront (separate terminal, from apps/web)
cp .env.local.example .env.local
npm run dev          # http://localhost:3000

# 7. Run the admin panel (separate terminal, from apps/admin)
npm run dev          # http://localhost:5173
```

Seeded super admin credentials are printed by the seed script (`SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD` env vars override the defaults). **Change this password immediately in any
non-local environment.**

## Testing

```bash
cd apps/api
npx jest --config ./test/jest-e2e.json
```

The e2e suite runs against the real Postgres instance from `docker-compose.yml` and covers: health
check, public store settings, unauthenticated rejection, registration, duplicate-registration
rejection, wrong-password rejection, login + `/auth/me`, RBAC rejection of a plain customer on an
admin-only route, refresh-token rotation (and rejection of a reused/rotated-out token), and admin
login against a permission-gated route.

## Security notes for Phase 1

- Passwords hashed with Argon2; refresh tokens are opaque random values, stored only as a SHA-256
  hash, rotated on every use, and revoked on password reset.
- Email verification and password reset currently log their token to the server console instead of
  sending an email — real delivery lands with the Notifications module (Phase 6). Do not treat this
  as production-ready until that lands.
- Known non-blocking item: `npm audit` reports vulnerabilities in transitive dev-only tooling
  (`@nestjs/cli`'s bundled `webpack`/`inquirer`/`tmp`) and in `multer`/`postcss`/`next`'s own
  transitive deps, all requiring a breaking major-version bump to clear. None are reachable from
  this app's current code paths (no file uploads yet); revisit before each phase that touches those
  areas.

## Roadmap

| Phase | Scope |
|---|---|
| 1 (done) | Repo scaffold, Docker infra, Store/StoreSettings, Users/Roles/Permissions, Auth, RBAC, audit logging, health checks |
| 2 | Catalog: Products, Variants, Categories, Brands, Attributes, Inventory basics |
| 3 | Cart, Wishlist, Checkout, Coupons/Promotions |
| 4 | Orders, Payments (Razorpay), Shipping, Refunds |
| 5 | Reviews, CMS (homepage sections, pages, blog, FAQ) |
| 6 | Notifications (email/SMS/WhatsApp), Search/filters |
| 7 | Admin Panel full build-out, Reports/Analytics |
| 8 | Hardening: 2FA enforcement, monitoring, load testing, docs, deployment |
