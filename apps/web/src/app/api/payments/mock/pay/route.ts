import { NextRequest } from 'next/server';
import { proxyApiRequest } from '../../../../../lib/server/api-proxy';

// Only answers when the API runs the dummy test gateway (PAYMENT_MODE=mock); otherwise it 404s.
export async function POST(request: NextRequest) {
  const body = await request.json();
  return proxyApiRequest('/payments/mock/pay', 'POST', body);
}
