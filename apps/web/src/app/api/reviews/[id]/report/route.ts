import { NextRequest } from 'next/server';
import { proxyApiRequest } from '../../../../../lib/server/api-proxy';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json();
  return proxyApiRequest(`/reviews/${encodeURIComponent(id)}/report`, 'POST', body);
}
