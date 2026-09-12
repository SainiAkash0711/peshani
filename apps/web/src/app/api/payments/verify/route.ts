import { NextRequest } from 'next/server';
import { proxyApiRequest } from '../../../../lib/server/api-proxy';

export async function POST(request: NextRequest) {
  const body = await request.json();
  return proxyApiRequest('/payments/razorpay/verify', 'POST', body);
}
