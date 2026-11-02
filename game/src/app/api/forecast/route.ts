import { backend, relay } from '@/lib/backend';

export async function POST(req: Request) {
  return relay(await backend('/forecast', { method: 'POST', body: await req.text() }));
}
