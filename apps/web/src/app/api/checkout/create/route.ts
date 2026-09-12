import { NextRequest } from 'next/server';
import { proxyApiRequest } from '../../../../lib/server/api-proxy';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const idempotencyKey = request.headers.get('idempotency-key');
  return proxyApiRequest('/checkout/create', 'POST', body, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined);
}
