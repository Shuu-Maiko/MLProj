import { backend, relay } from '@/lib/backend';

export async function GET(req: Request) {
  const query = new URL(req.url).search;
  return relay(await backend(`/history${query}`));
}
