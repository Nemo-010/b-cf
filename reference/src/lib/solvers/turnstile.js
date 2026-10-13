/**
 * Turnstile: what a Worker can and cannot do.
 *
 * Turnstile mints its token inside a real page. The flow is:
 *   1. the page loads https://challenges.cloudflare.com/turnstile/v0/api.js
 *   2. /turnstile/v0/.../flow/ov1 returns a challenge containing a proof-of-work
 *      (p), a ray (cRay) and a metadata blob (md)
 *   3. the page answers the PoW and POSTs the encrypted payload to /pat/
 *   4. /pat/ returns cf_clearance (a managed challenge) or the widget callback
 *      token (a standalone widget)
 *
 * Step 3 is where a request-only reimplementation dies. Published request-based
 * solvers do it with a browser-grade TLS fingerprint (munew/cloudflare-turnstile
 * -solver builds on `rquest` with Emulation::Chrome136) *and* a re-implementation
 * of Cloudflare's obfuscated VM. A Worker has neither: the TLS stack belongs to
 * the runtime and the JS VM is not extractable from a Worker. That is why this
 * module does not ship a pure-request solve.
 *
 * What it does instead: read the widget parameters so the caller can decide, and
 * wait for the widget to self-issue inside the browser session we already have.
 */

export const TURNSTILE_SCRIPT = /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/;

/**
 * Read Turnstile widget parameters from a live page, in its main frame and in
 * any child frame the widget was mounted in.
 *
 * @param {any} page Puppeteer page
 */
export async function inspectTurnstile(page) {
  if (!page) return null;
  const frames = page.frames?.() ?? [page];
  for (const frame of frames) {
    const params = await frame.evaluate?.(() => {
      const el = document.querySelector('[data-sitekey], .cf-turnstile, [class*="cf-turnstile"]');
      if (!el) return null;
      const script = [...document.querySelectorAll('script[src]')]
        .map((s) => s.src)
        .find((src) => src.includes('/turnstile/v0/api.js'));
      return {
        sitekey: el.getAttribute?.('data-sitekey') || null,
        action: el.getAttribute?.('data-action') || null,
        cData: el.getAttribute?.('data-cdata') || null,
        mode: el.getAttribute?.('data-callback') || null,
        script: script || null,
        hosted: location.host,
      };
    });
    if (params?.sitekey) return params;
  }
  return null;
}

/**
 * Wait for a Turnstile widget to hand back a token on its own.
 *
 * `turnstile.render` accepts a callback; sites that use the implicit widget put
 * the token in `input[name="cf-turnstile-response"]` (or a textarea). Both are
 * watched. This succeeds when the page's own JS passes the non-interactive
 * checks, which is exactly the situation where the browser looks real enough.
 *
 * @param {any} page
 * @param {number} timeoutMs
 * @returns {Promise<string|null>}
 */
export async function waitForWidget(page, timeoutMs = 25_000) {
  if (!page?.waitForFunction) return null;
  const started = Date.now();
  try {
    await page.waitForFunction(
      () => {
        const input = document.querySelector(
          'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], input[name="g-recaptcha-response"]',
        );
        return Boolean(input && input.value && input.value.length > 20);
      },
      { timeout: timeoutMs, polling: 500 },
    );
  } catch {
    return null;
  }
  const token = await page.evaluate(() => {
    const input = document.querySelector(
      'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], input[name="g-recaptcha-response"]',
    );
    return input?.value || null;
  });
  return token ? { token, ms: Date.now() - started } : null;
}

/**
 * Machine-readable, honest answer for callers that ask "can you solve this?".
 */
export function turnstileCapability() {
  return {
    pureRequestSolve: false,
    browserAssisted: 'self-issue only (no interactive answer exists)',
    requiresTlsEmulation: true,
    requiresBrowserVm: true,
    upstreamEvidence: [
      'https://github.com/munew/cloudflare-turnstile-solver (uses rquest Emulation::Chrome136)',
      'https://developers.cloudflare.com/turnstile/ (non-interactive JS challenge, PoW, proof-of-space)',
    ],
  };
}
