import { NextRequest } from 'next/server';
import { proxyLogin } from '../../../../lib/server/auth-proxy';

export async function POST(request: NextRequest) {
  const body = await request.json();
  return proxyLogin(body);
}
