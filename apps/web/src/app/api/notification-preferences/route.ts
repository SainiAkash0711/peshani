import { NextRequest } from 'next/server';
import { proxyApiRequest } from '../../../lib/server/api-proxy';

export async function GET() {
  return proxyApiRequest('/notification-preferences', 'GET');
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return proxyApiRequest('/notification-preferences', 'PATCH', body);
}
