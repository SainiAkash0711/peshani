import { proxyApiRequest } from '../../../../../lib/server/api-proxy';

interface RouteParams {
  params: Promise<{ orderNumber: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { orderNumber } = await params;
  return proxyApiRequest(`/checkout/orders/${encodeURIComponent(orderNumber)}/retry-payment`, 'POST');
}
