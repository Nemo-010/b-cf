/**
 * Tier 0s — userland TLS and HTTP/2 over `cloudflare:sockets` `connect()`.
 *
 * This is a seam, not a TLS implementation. Writing a correct TLS stack is a
 * project with its own test corpus, and a research reference that shipped a
 * half-audited one would be worse than useless. What lives here is the wiring:
 * one place that says where a userland transport plugs in, what it must return,
 * and why it is opt-in.
 *
 * Why it exists at all: `fetch()` cannot present a browser ClientHello, because
 * the runtime owns the handshake. `connect({ secureTransport: 'off' })` returns
 * a raw byte stream, so a transport built on it can. See RESEARCH.md §2,
 * Layer 1 for the proof and for prior art:
 *
 *   - latentharbor/tunnelfetch — TLS 1.2/1.3 + HTTP/2 + HPACK in userland ESM
 *   - EithonX/socksflare       — rustls compiled to WASM
 *
 * Bind either one (or anything with the same shape) to `env.TLS_TRANSPORT`:
 *
 *   env.TLS_TRANSPORT = new Client({ connect, trust: { mode: 'system' } }) *
 * What the transport must provide:
 *
 *   fetch(url, { headers }) -> Response
 *
 * where `headers` is a `Headers` object built by the same profile helper the
 * fetch engine uses, so the header order cannot diverge from the ClientHello.
 * The transport is responsible for shaping the ClientHello, HTTP/2 SETTINGS
 * and pseudo-header order from that same profile. Sending a matching
 * User-Agent over a non-matching handshake is worse than sending an honest
 * one, because the mismatch is the signal.
 *
 * Cost, stated plainly so it is a decision rather than a surprise:
 *
 *   - one full handshake per connection, and a fresh connection per request at
 *     the edge (measured elsewhere at ~10 ms CPU vs 0.9 ms warm)
 *   - HTTP/2 costs MORE CPU than HTTP/1.1 — HPACK is compression work on a
 *     CPU-metered platform
 *   - Workers Paid allows 30M CPU-ms/month, an isolate has 128 MB and six
 *     simultaneous connections
 *
 * So this engine is never selected from `auto`. It runs only when the caller
 * asks for it, and it degrades to a clear error rather than silently falling
 * back to the transport whose fingerprint the caller was trying to escape.
 */

import { browserHeaders } from '../profiles.js';

export const TLS_ENGINE_ID = 'tls';

export function tlsEngineAvailable(env) {
  return typeof env?.TLS_TRANSPORT?.fetch === 'function';
}

/**
 * @param {object} env
 * @param {{ url: string, profile: object, headers?: Record<string,string> }} opts
 * @returns {Promise<{ res: Response, engine: string }>}
 */
export async function tlsEngine(env, { url, profile, headers = {} }) {
  if (!env?.TLS_TRANSPORT) {
    throw new Error(
      'tls engine selected but env.TLS_TRANSPORT is not bound; ' +
        'see reference/src/lib/engines/tls.js for what to bind',
    );
  }
  if (typeof env.TLS_TRANSPORT.fetch !== 'function') {
    throw new Error('env.TLS_TRANSPORT must expose fetch(url, { headers })');
  }
  // Same profile helper as the fetch engine: the header order on the wire and
  // the ClientHello the transport sends have to come from one description.
  const res = await env.TLS_TRANSPORT.fetch(url, {
    headers: browserHeaders(profile, headers, { navigate: false }),
  });
  return { res, engine: TLS_ENGINE_ID };
}
