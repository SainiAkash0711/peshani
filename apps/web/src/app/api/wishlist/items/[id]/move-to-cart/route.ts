import { NextRequest } from 'next/server';
import { proxyApiRequest } from '../../../../../../lib/server/api-proxy';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return proxyApiRequest(`/wishlist/items/${encodeURIComponent(id)}/move-to-cart`, 'POST', body);
}
