import { NextRequest } from 'next/server';
import { proxyCartRequest } from '../../../../lib/server/cart-proxy';

export async function POST(request: NextRequest) {
  const body = await request.json();
  return proxyCartRequest('/cart/items', 'POST', body);
}
