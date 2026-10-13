/**
 * Response cache. Render output is stable for minutes-to-hours while browser
 * time is metered, so the cache is where the money is.
 *
 * Uses the Workers Cache API (free) keyed on the normalised target URL plus
 * engine, and only for GET. Never caches a challenge verdict.
 */

const VARY = new Set([
  'accept',
  'accept-language',
  'accept-encoding',
  'user-agent',
]);

const SKIP = /set-cookie|authorization|cookie/i;

export function cacheRequest(request, key) {
  return new Request(key, {
    method: 'GET',
    headers: { 'x-rv-cache': '1', ...(request.headers.get('accept') ? { accept: request.headers.get('accept') } : {}) },
  });
}

export async function cacheGet(cacheKey) {
  try {
    const hit = await caches.default.match(new Request(cacheKey));
    return hit || null;
  } catch {
    return null;
  }
}

export async function cachePut(cacheKey, res, ttl) {
  if (!ttl || ttl <= 0) return;
  try {
    const h = new Headers(res.headers);
    h.set('cache-control', `public, max-age=${Math.min(ttl, 86400)}`);
    h.delete('set-cookie');
    await caches.default.put(new Request(cacheKey), new Response(res.body, { status: res.status, headers: h }));
  } catch {
    /* cache is best-effort */
  }
}

export function cacheable(request, verdict) {
  if (request.method !== 'GET') return false;
  if (verdict && verdict.challenge) return false;
  if (SKIP.test(request.headers.get('authorization') || '')) return false;
  if (request.headers.get('cookie')) return false;
  return true;
}

export function cacheKey(url, engine, profile) {
  // Normalise: drop tracking params that should not fragment the cache.
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_eid)/i.test(k)) u.searchParams.delete(k);
  }
  return `https://rv-cache.internal/${engine}/${profile}/${encodeURIComponent(u.toString())}`;
}

export { VARY };
