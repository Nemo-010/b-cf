/**
 * Tier 1/2 engine: Cloudflare Browser Run.
 *
 * Two modes:
 *   quickAction()  one-shot, Browser Run owns the session lifecycle and billing
 *                  is browser-hours only. Best default.
 *   session()      Puppeteer over the browser binding, for pages that need
 *                  interaction, cookies that outlive one action, or a solver.
 *                  Also bills for concurrent browsers.
 *
 * What Browser Run does NOT give us, and cannot be configured away:
 *   - non-removable request headers (cf-brapi-*, cf-biso-*, Signature*)
 *   - per-request egress IP rotation (Cloudflare ranges only)
 *   - a bot-detection identity that reads as human
 * See RESEARCH.md and the Browser Run FAQ, "Will Browser Run be detected by
 * Bot Management?".
 */

const QUICK_ACTION_PATH = {
  content: 'content',
  markdown: 'markdown',
  screenshot: 'screenshot',
  pdf: 'pdf',
  snapshot: 'snapshot',
  links: 'links',
  scrape: 'scrape',
  json: 'json',
  accessibilityTree: 'accessibilityTree',
};

/** Normalise both the binding and the REST shape into a Response. */
async function runQuickAction(env, action, params) {
  if (env?.BROWSER?.quickAction) {
    return env.BROWSER.quickAction(action, params);
  }
  if (!env?.CF_ACCOUNT_ID || !env?.CF_API_TOKEN) {
    throw new Error('no BROWSER binding and no CF_ACCOUNT_ID/CF_API_TOKEN for the REST fallback');
  }
  const path = QUICK_ACTION_PATH[action] || action;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-run/${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.CF_API_TOKEN}` },
      body: JSON.stringify(params),
    },
  );
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return res;
  const payload = await res.json();
  if (!payload.success) {
    return new Response(JSON.stringify(payload), { status: 502, headers: { 'content-type': 'application/json' } });
  }
  const result = payload.result;
  if (action === 'content' || action === 'markdown') {
    return new Response(typeof result === 'string' ? result : result?.content || '', {
      status: 200,
      headers: { 'content-type': action === 'markdown' ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8' },
    });
  }
  return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
}

/**
 * One-shot render. Returns a Response whose body is the requested shape.
 *
 * @param {any} env
 * @param {{url:string, action?:keyof QUICK_ACTION_PATH, userAgent?:string, waitUntil?:string, timeout?:number, cookies?:any[], headers?:Record<string,string>, browser?:string, cacheTTL?:number}} opts
 */
export async function quickAction(env, opts) {
  const action = opts.action || 'markdown';
  const params = {
    url: opts.url,
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
    ...(opts.cacheTTL != null ? { cacheTTL: opts.cacheTTL } : { cacheTTL: 0 }),
    ...(opts.cookies ? { cookies: opts.cookies } : {}),
    ...(opts.headers ? { setExtraHTTPHeaders: opts.headers } : {}),
    ...(opts.browser ? { browser: opts.browser } : {}),
    gotoOptions: {
      waitUntil: opts.waitUntil || 'networkidle2',
      timeout: opts.timeout ?? 45_000,
    },
  };
  const started = Date.now();
  const res = await runQuickAction(env, action, params);
  return { res, engine: `browser-run:${action}`, ms: Date.now() - started };
}

/**
 * Attach a Puppeteer page to a page-hook set that removes the most obvious
 * headless tells. This is not stealth; it removes noise so that a site's own
 * scripts do not fail on a missing API. Anything TLS- or IP-level is untouched.
 */
export const MINIMAL_PAGE_HOOKS = async () => {
  /* eslint-disable no-undef */
  if (!('WebGL2RenderingContext' in window)) return;
  const patch = (proto) => {
    const orig = proto.getParameter;
    proto.getParameter = function (p) {
      if (p === 37445) return 'Intel Inc.';
      if (p === 37446) return 'Intel Iris OpenGL Engine';
      return orig.call(this, p);
    };
  };
  patch(WebGLRenderingContext.prototype);
  patch(WebGL2RenderingContext.prototype);
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  }
  /* eslint-enable no-undef */
};

/**
 * Session render. Lazily imports @cloudflare/puppeteer so that the fetch-only
 * deployment and the unit tests do not need the dependency.
 *
 * @param {any} env
 * @param {{url:string, keepAlive?:number, hooks?:Function[], userAgent?:string, solve?:Function}} opts
 */
export async function session(env, opts) {
  if (!env?.BROWSER) throw new Error('session mode needs the BROWSER binding');
  const puppeteer = await import('@cloudflare/puppeteer').catch(() => null);
  if (!puppeteer) throw new Error('@cloudflare/puppeteer is not installed');

  const launchOpts = {};
  if (opts.keepAlive) launchOpts.keep_alive = opts.keepAlive;

  const browser = await (opts.reuse ? puppeteer.connect(env.BROWSER, opts.reuse) : puppeteer.launch(env.BROWSER, launchOpts));
  const started = Date.now();
  try {
    const page = await browser.newPage();
    if (opts.userAgent) await page.setUserAgent(opts.userAgent);
    for (const hook of opts.hooks || [MINIMAL_PAGE_HOOKS]) {
      await page.evaluateOnNewDocument(hook);
    }
    if (opts.headers) await page.setExtraHTTPHeaders(opts.headers);

    const resp = await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: opts.timeout ?? 45_000 });
    const html = await page.content();
    const status = resp?.status() ?? 200;

    let solved = null;
    if (opts.solve) solved = await opts.solve({ page, browser, env });

    return {
      engine: 'browser-run:session',
      ms: Date.now() - started,
      sessionId: browser.sessionId?.() ?? undefined,
      status,
      html,
      solved,
    };
  } finally {
    // Always close: an unclosed session bills until it idle-times-out.
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
  }
}

export { runQuickAction };
