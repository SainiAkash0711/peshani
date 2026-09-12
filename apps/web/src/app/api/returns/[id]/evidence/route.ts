import { NextRequest } from 'next/server';
import { proxyMultipartRequest } from '../../../../../lib/server/api-proxy';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const formData = await request.formData();
  return proxyMultipartRequest(`/returns/${encodeURIComponent(id)}/evidence`, formData);
}
