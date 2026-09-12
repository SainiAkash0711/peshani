import { NextRequest } from 'next/server';
import { proxyApiRequest } from '../../../../lib/server/api-proxy';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json();
  return proxyApiRequest(`/reviews/${encodeURIComponent(id)}`, 'PATCH', body);
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  return proxyApiRequest(`/reviews/${encodeURIComponent(id)}`, 'DELETE');
}
