import { NextRequest } from 'next/server';
import { proxyApiRequest } from '../../../../../lib/server/api-proxy';

interface RouteParams {
  params: Promise<{ orderNumber: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { orderNumber } = await params;
  const body = await request.json().catch(() => ({}));
  return proxyApiRequest(`/orders/${encodeURIComponent(orderNumber)}/cancel`, 'POST', body);
}
