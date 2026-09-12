import { proxyApiRequest } from '../../../../../lib/server/api-proxy';

interface RouteParams {
  params: Promise<{ orderNumber: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { orderNumber } = await params;
  return proxyApiRequest(`/orders/${encodeURIComponent(orderNumber)}/return-eligibility`, 'GET');
}
