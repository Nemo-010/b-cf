/**
 * Tier 0 engine: a plain subrequest with a browser-shaped header set.
 *
 * Cheap (single fetch, no browser hours), and sufficient for the large majority
 * of URLs. It is *not* an anti-bot layer: the runtime's TLS stack and the
 * Cloudflare egress headers are what the origin sees no matter what we send
 * here. See RESEARCH.md.
 */

import { PROFILES, DEFAULT_PROFILE, browserHeaders, STRIP_REQUEST_HEADERS } from '../profiles.js';
import { classify } from '../detect.js';

const HOP_BY_HOP_RESPONSE = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]);

/**
 * @param {Request} request client request
 * @param {{url:string, method?:string, body?:BodyInit|null, profile?:string, headers?:Record<string,string>, navigate?:boolean}} opts
 */
export async function fetchEngine(request, opts) {
  const profile = PROFILES[opts.profile] || PROFILES[DEFAULT_PROFILE];
  const extra = { ...(opts.headers || {}) };

  for (const [k, v] of request.headers) {
    const lk = k.toLowerCase();
    if (STRIP_REQUEST_HEADERS.has(lk)) continue;
    if (extra[lk] != null) continue;
    extra[k] = v;
  }

  const headers = browserHeaders(profile, extra, { navigate: opts.navigate !== false });
  if (opts.method && opts.method !== 'GET' && opts.method !== 'HEAD') {
    const ct = request.headers.get('content-type');
    if (ct) headers.set('content-type', ct);
  }

  const started = Date.now();
  const res = await fetch(opts.url, {
    method: opts.method || request.method,
    headers,
    body: opts.body ?? (request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body),
    redirect: 'follow',
    // Browser Run / Workers default; the origin gets a real subrequest either way.
    cf: { cacheTtl: 0 },
  });

  return { res, engine: 'fetch', ms: Date.now() - started, profile: profile.name };
}

/** Read a response as text for classification, without consuming it twice. */
export async function viewResponse(res, limit = 400_000) {
  const ctype = res.headers.get('content-type') || '';
  const isText = /text\/|json|xml|javascript/i.test(ctype);
  let body = '';
  if (isText) {
    const buf = await res.clone().arrayBuffer();
    body = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, limit));
  }
  return { status: res.status, headers: res.headers, body, contentType: ctype, cancelled: !isText };
}

/** A response destined for the caller: strip hop-by-hop headers we already handled. */
export function relayHeaders(res) {
  const out = new Headers();
  for (const [k, v] of res.headers) {
    if (HOP_BY_HOP_RESPONSE.has(k.toLowerCase())) continue;
    out.set(k, v);
  }
  return out;
}

export { classify };
