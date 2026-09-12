import { NextRequest } from 'next/server';
import { proxyApiRequest } from '../../../../../lib/server/api-proxy';

interface RouteParams {
  params: Promise<{ productId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { productId } = await params;
  const query = request.nextUrl.search;
  return proxyApiRequest(`/products/${encodeURIComponent(productId)}/reviews${query}`, 'GET');
}
