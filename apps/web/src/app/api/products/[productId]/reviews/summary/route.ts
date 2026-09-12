import { proxyApiRequest } from '../../../../../../lib/server/api-proxy';

interface RouteParams {
  params: Promise<{ productId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { productId } = await params;
  return proxyApiRequest(`/products/${encodeURIComponent(productId)}/reviews/summary`, 'GET');
}
