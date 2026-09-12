import { proxyCartRequest } from '../../../lib/server/cart-proxy';

export async function GET() {
  return proxyCartRequest('/cart', 'GET');
}

export async function DELETE() {
  return proxyCartRequest('/cart', 'DELETE');
}
