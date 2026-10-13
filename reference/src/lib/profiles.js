/**
 * Browser profiles distilled from the Azathothas/b-ids corpus.
 *
 * Every value here is a measurement, not a guess. Provenance:
 *   repo    https://github.com/Azathothas/b-ids            (branch: data)
 *   index   routes/routes.json
 *   routes  routes/header-order/<browser>/<channel>/latest/<platform>/navigate.list.txt
 *           routes/user-agent/<browser>/<channel>/latest/<platform>/navigate.txt
 *           routes/sec-ch-ua/<browser>/<channel>/latest/<platform>/navigate.txt
 *           routes/accept-language/<browser>/<channel>/latest/<platform>/navigate.txt
 *
 * Regenerate with:  node tools/bids-profile.mjs
 *
 * What this file does *not* give you: the TLS ClientHello. Over `fetch()` the
 * runtime owns the handshake, so these headers are the whole of what a plain
 * subrequest can shape. A ClientHello is possible, but it needs a transport of
 * its own over `cloudflare:sockets` `connect()` — see `lib/engines/tls.js` and
 * RESEARCH.md, "Layer 1". Do not send these headers over a handshake that is
 * not theirs; the mismatch is the tell.
 *
 * `headerOrder` is the on-the-wire order a real Chrome sends for a top-level
 * navigation. It is the only part of a request a Worker can still get wrong
 * after setting the right values, so we set it explicitly and never merge these
 * into a plain object.
 */

export const PROFILES = Object.freeze({
  'chrome-155-linux': {
    name: 'chrome-155-linux',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    secChUa: '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Linux"',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptEncoding: 'gzip, deflate, br, zstd',
    headerOrder: [
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
      'upgrade-insecure-requests',
      'user-agent',
      'accept',
      'sec-fetch-site',
      'sec-fetch-mode',
      'sec-fetch-user',
      'sec-fetch-dest',
      'accept-encoding',
      'accept-language',
      'priority',
    ],
    // Chrome shuffles the TLS ClientHello extension order per connection since
    // ~M110, which is why JA3 is unstable for it and JA4 (sorted) is used.
    measuredJa4: 't13i1516h2_8daaf6152771_6ff14566cf4a',
    ja4Note: 'capture has no SNI (i); cipher hash matches the shared Chrome/Firefox suite set',
  },
  'chrome-155-win64': {
    name: 'chrome-155-win64',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    secChUa: '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"',
    acceptLanguage: 'en-US,en;q=0.9',
    acceptEncoding: 'gzip, deflate, br, zstd',
    headerOrder: [
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
      'upgrade-insecure-requests',
      'user-agent',
      'accept',
      'sec-fetch-site',
      'sec-fetch-mode',
      'sec-fetch-user',
      'sec-fetch-dest',
      'accept-encoding',
      'accept-language',
      'priority',
    ],
    measuredJa4: 't13i1516h2_8daaf6152771_499011852565',
  },
});

export const DEFAULT_PROFILE = 'chrome-155-linux';

export const NAV_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';

/**
 * Build a fetch() Headers object whose insertion order matches the profile.
 * Do not pass an object literal; Headers preserves insertion order and the
 * object literal does not.
 *
 * @param {object} profile entry from PROFILES
 * @param {Record<string,string>} extra additional headers (appended, in order)
 * @param {{navigate?:boolean}} [opts]
 */
export function orderedBrowserHeaderPairs(profile, extra = {}, opts = {}) {
  const navigate = opts.navigate !== false;
  const values = {
    'sec-ch-ua': profile.secChUa,
    'sec-ch-ua-mobile': profile.secChUaMobile,
    'sec-ch-ua-platform': profile.secChUaPlatform,
    'upgrade-insecure-requests': '1',
    'user-agent': profile.userAgent,
    accept: NAV_ACCEPT,
    'sec-fetch-site': 'none',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-user': '?1',
    'sec-fetch-dest': 'document',
    'accept-encoding': profile.acceptEncoding,
    'accept-language': profile.acceptLanguage,
    priority: 'u=0, i',
  };

  const pairs = [];
  for (const name of profile.headerOrder) {
    if (!navigate && /^sec-fetch-user$/.test(name)) continue;
    if (values[name] != null) pairs.push([name, values[name]]);
  }
  for (const [k, v] of Object.entries(extra)) {
    const key = k.toLowerCase();
    const at = pairs.findIndex(([name]) => name === key);
    if (at >= 0) pairs[at][1] = v;
    else pairs.push([key, v]);
  }
  return pairs;
}

/**
 * Build the outgoing Headers in profile order.
 *
 * Caveat, and it is a real one: order survives only if the runtime preserves
 * `Headers` insertion order on the wire. workerd does; Node's undici sorts
 * keys, which is why the unit test asserts on the pairs and not on
 * `headers.keys()`. Whether the Cloudflare edge keeps our order for an
 * outbound subrequest is not something we could verify without a deployed
 * zone; treat header order as best-effort, not a guarantee.
 */
export function browserHeaders(profile, extra = {}, opts = {}) {
  const h = new Headers();
  for (const [k, v] of orderedBrowserHeaderPairs(profile, extra, opts)) h.set(k, v);
  return h;
}

/** Headers a Worker must never forward from the client. */
export const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'expect',
  'keep-alive',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
  // client-linked identity
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-server',
  'x-real-ip',
  'forwarded',
  'via',
  // Cloudflare's own edge markers; the edge re-adds them on egress regardless,
  // so re-sending a client's copy only mixes two identities together
  'cdn-loop',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'cf-worker',
  'cf-ew-via',
  'cf-ew-preview-server',
]);
