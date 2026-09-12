# syntax=docker/dockerfile:1
#
# Multi-stage production build for the Peshani customer storefront (Next.js).
# Build context is the REPO ROOT (npm workspaces) - build with:
#   docker build -f apps/web/Dockerfile -t peshani-web .

FROM node:20-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /workspace
# Unlike apps/api (which has a couple of non-hoistable native packages of
# its own), npm fully hoists apps/web's dependencies into the root
# node_modules - confirmed by actually running this build, which failed
# with "COPY failed: stat workspace/apps/web/node_modules: file does not
# exist" until this per-workspace COPY was removed.
COPY --from=deps /workspace/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/web ./apps/web
# NEXT_PUBLIC_* values are baked into the client bundle at BUILD time, not
# read at container startup - real values must be supplied here as build
# args for a real deployment, never left at their localhost defaults.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NODE_ENV=production
RUN npm run build --workspace apps/web

FROM node:20-alpine AS runtime
RUN apk add --no-cache curl \
  && addgroup -S peshani && adduser -S peshani -G peshani
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# `output: 'standalone'` (next.config.mjs) traces only the files actually
# needed to run `node server.js` - no full node_modules copy required.
# Static assets and `public/` are NOT included in the standalone trace by
# Next.js design and must be copied separately.
COPY --from=build /workspace/apps/web/.next/standalone ./
COPY --from=build /workspace/apps/web/.next/static ./apps/web/.next/static
RUN chown -R peshani:peshani /app
WORKDIR /app/apps/web
USER peshani
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:3000/ || exit 1
CMD ["node", "server.js"]
