import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  // Served in production behind the reverse proxy at /admin/ (see
  // deploy/nginx/nginx.conf), not from the origin root like local dev's own
  // Vite server - without this, every asset reference in the built
  // index.html resolves to /assets/... instead of /admin/assets/..., which
  // the proxy then routes to the web (Next.js) container instead of this
  // app, and the whole page silently renders blank.
  base: mode === 'production' ? '/admin/' : '/',
  plugins: [react()],
  server: { port: 5173 },
}));
