import { proxyApiRequest } from '../../../../lib/server/api-proxy';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return proxyApiRequest(`/returns/${encodeURIComponent(id)}`, 'GET');
}
