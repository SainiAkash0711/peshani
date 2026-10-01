import { NextRequest } from 'next/server';
import { proxyPublicAuthAction } from '../../../../lib/server/auth-proxy';

export async function POST(request: NextRequest) {
  const body = await request.json();
  return proxyPublicAuthAction('/auth/reset-password', body);
}
