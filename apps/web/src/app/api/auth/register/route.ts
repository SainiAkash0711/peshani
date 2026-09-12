import { NextRequest } from 'next/server';
import { proxyRegister } from '../../../../lib/server/auth-proxy';

export async function POST(request: NextRequest) {
  const body = await request.json();
  return proxyRegister(body);
}
