import { proxyApiRequest } from '../../../lib/server/api-proxy';

export async function GET() {
  return proxyApiRequest('/wishlist', 'GET');
}
