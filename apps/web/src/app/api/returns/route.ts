import { NextRequest } from 'next/server';
import { proxyApiRequest } from '../../../lib/server/api-proxy';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.search;
  return proxyApiRequest(`/returns${query}`, 'GET');
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return proxyApiRequest('/returns', 'POST', body);
}
