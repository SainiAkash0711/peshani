import { NextRequest } from 'next/server';
import { proxyCartRequest } from '../../../../../lib/server/cart-proxy';

interface RouteParams {
  params: Promise<{ itemId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { itemId } = await params;
  const body = await request.json();
  return proxyCartRequest(`/cart/items/${encodeURIComponent(itemId)}`, 'PATCH', body);
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { itemId } = await params;
  return proxyCartRequest(`/cart/items/${encodeURIComponent(itemId)}`, 'DELETE');
}
