import { NextRequest } from 'next/server';
import { proxyApiRequest } from '../../../lib/server/api-proxy';

export async function GET(request: NextRequest) {
  return proxyApiRequest(`/notifications${request.nextUrl.search}`, 'GET');
}
