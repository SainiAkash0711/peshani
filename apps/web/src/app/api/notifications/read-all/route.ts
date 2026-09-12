import { proxyApiRequest } from '../../../../lib/server/api-proxy';

export async function PATCH() {
  return proxyApiRequest('/notifications/read-all', 'PATCH');
}
