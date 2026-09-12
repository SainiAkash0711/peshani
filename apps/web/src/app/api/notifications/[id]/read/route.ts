import { proxyApiRequest } from '../../../../../lib/server/api-proxy';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return proxyApiRequest(`/notifications/${encodeURIComponent(id)}/read`, 'PATCH');
}
