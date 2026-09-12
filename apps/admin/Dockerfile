# syntax=docker/dockerfile:1
#
# Production build for the Peshani admin SPA (Vite + React). This is a pure
# static build (`vite build` -> dist/) with no server-side runtime of its
# own - served here by a minimal nginx, per §3's "serve using an appropriate
# production web server" instruction. Build context is the REPO ROOT:
#   docker build -f apps/admin/Dockerfile -t peshani-admin .

FROM node:20-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /workspace
# apps/admin has no non-hoistable packages of its own - see apps/web/Dockerfile's
# identical note (confirmed the same way, by actually running this build).
COPY --from=deps /workspace/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/admin ./apps/admin
# VITE_* values are baked into the bundle at build time (same as Next's
# NEXT_PUBLIC_* above) - must be supplied as a real build arg in production.
ARG VITE_API_BASE_URL=http://localhost:4000/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build --workspace apps/admin

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache curl
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/admin/dist /usr/share/nginx/html
# nginx's official image already runs its worker processes as an
# unprivileged user by default; the master process itself needs root only
# to bind port 80 and read the config - a standard, accepted exception for
# this specific image, not a general "run as root" pattern.
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
