import { proxyMe } from '../../../../lib/server/auth-proxy';

export async function GET() {
  return proxyMe();
}
