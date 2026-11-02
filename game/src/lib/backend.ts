/**
 * Server-side hop to the model service.
 *
 * The browser talks to Next, Next talks to FastAPI: that keeps the backend origin out of
 * the client bundle and avoids a CORS dance in development.
 */

const BACKEND = process.env.FORECAST_API ?? 'http://127.0.0.1:8000';

export async function backend(path: string, init?: RequestInit) {
  const res = await fetch(`${BACKEND}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
    cache: 'no-store',
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

export function relay({ status, body }: { status: number; body: string }) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
