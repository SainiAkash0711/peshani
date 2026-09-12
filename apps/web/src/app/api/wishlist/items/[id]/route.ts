import { proxyApiRequest } from '../../../../../lib/server/api-proxy';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return proxyApiRequest(`/wishlist/items/${encodeURIComponent(id)}`, 'DELETE');
}
