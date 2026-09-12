import { NextRequest } from 'next/server';
import { proxyGetProfile, proxyUpdateProfile } from '../../../../lib/server/auth-proxy';

export async function GET() {
  return proxyGetProfile();
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  return proxyUpdateProfile(body);
}
