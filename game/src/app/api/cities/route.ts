import { backend, relay } from '@/lib/backend';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hour = searchParams.get('hour') ?? '0';
  return relay(await backend(`/cities?hour=${encodeURIComponent(hour)}`));
}
