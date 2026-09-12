import { proxyLogout } from '../../../../lib/server/auth-proxy';

export async function POST() {
  return proxyLogout();
}
