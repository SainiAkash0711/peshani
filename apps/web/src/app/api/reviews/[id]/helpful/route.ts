import { proxyApiRequest } from '../../../../../lib/server/api-proxy';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return proxyApiRequest(`/reviews/${encodeURIComponent(id)}/helpful`, 'POST');
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return proxyApiRequest(`/reviews/${encodeURIComponent(id)}/helpful`, 'DELETE');
}
