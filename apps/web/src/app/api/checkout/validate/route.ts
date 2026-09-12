import { proxyApiRequest } from '../../../../lib/server/api-proxy';

export async function POST() {
  return proxyApiRequest('/checkout/validate', 'POST');
}
