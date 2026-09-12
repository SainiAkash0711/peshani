# syntax=docker/dockerfile:1
#
# Multi-stage production build for the Peshani API (NestJS).
#
# This is an npm-workspaces monorepo (root package.json lists apps/api,
# apps/web, apps/admin) - the build context for this Dockerfile is the
# REPO ROOT, not apps/api, specifically so `npm ci` can resolve/hoist
# dependencies the same way local development does. Build with:
#   docker build -f apps/api/Dockerfile -t peshani-api .
# (from the repository root).

FROM node:20-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
# Only the api workspace's manifest is copied (not web/admin's) so this
# layer only invalidates when apps/api's own dependencies change - but the
# lockfile is the whole monorepo's, so `npm ci` still needs it present.
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/apps/api/node_modules ./apps/api/node_modules
COPY package.json package-lock.json ./
COPY apps/api ./apps/api
RUN npm run prisma:generate --workspace apps/api
RUN npm run build --workspace apps/api
# Removes devDependencies (typescript, @nestjs/cli, jest, ts-node, ...) from
# node_modules in place, leaving the already-built dist/ and the already-
# generated Prisma client (@prisma/client is a regular dependency, not a
# devDependency, so pruning never touches it) untouched.
RUN npm prune --omit=dev --workspace apps/api

FROM node:20-alpine AS runtime
# curl is needed only for the HEALTHCHECK below. openssl is needed by
# Prisma's query engine binary itself at runtime (it dynamically links
# against libssl.so.3) - Alpine's base node image ships neither by default,
# confirmed by actually running this image: it failed at startup with
# "Error loading shared library libssl.so.1.1: No such file or directory"
# until this was added (alongside pinning `binaryTargets =
# ["native", "linux-musl-openssl-3.0.x"]` in schema.prisma, which alone was
# not sufficient - the correct binary was generated, but the shared library
# it links against still had to actually be installed in this image).
RUN apk add --no-cache curl openssl \
  && addgroup -S peshani && adduser -S peshani -G peshani
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/prisma ./apps/api/prisma
COPY apps/api/package.json ./apps/api/package.json
# Must exist in the image BEFORE chown, not just be relied upon at runtime:
# STORAGE_LOCAL_ROOT resolves to this exact path, and it's also where
# docker-compose.prod.yml mounts the persistent media-storage named volume.
# A brand-new named volume has nothing on disk yet, so on first mount
# Docker initializes it by copying whatever already exists at the mount
# point IN THE IMAGE (including ownership) - if this directory didn't
# already exist here with the right owner, Docker creates the mount point
# itself owned by root, and the non-root `peshani` user below then can't
# write to it at all. Confirmed via a real container run: uploads failed
# with EACCES until this directory was created here first.
RUN mkdir -p /app/apps/api/storage && chown -R peshani:peshani /app
WORKDIR /app/apps/api
USER peshani
EXPOSE 4000
# Readiness (not liveness) is the right check here: Docker/Compose's own
# `healthy` status gates dependent services (e.g. a reverse proxy waiting
# via `depends_on: condition: service_healthy`) on the API actually being
# able to serve real traffic (database reachable), not merely "process started".
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:4000/api/v1/health/ready || exit 1
# Never ts-node, never `nest start --watch` - the compiled, production dist only.
CMD ["node", "dist/main.js"]
