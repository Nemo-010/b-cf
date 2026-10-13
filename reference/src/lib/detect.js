/**
 * Challenge / bot-wall classification.
 *
 * Pure function: given a fetch-worthy response view, decide whether the body we
 * got is the page we asked for or a gate in front of it. No I/O.
 *
 * Markers are split into `strong` (vendor-issued cookie / header / script host
 * that only that vendor emits) and `weak` (substring that can appear in normal
 * content). A verdict needs one strong marker, or two weak ones.
 */

export const CHALLENGE = Object.freeze({
  NONE: null,
  CLOUDFLARE_MANAGED: 'cloudflare-managed', // "Just a moment..." interstitial / cf_clearance gate
  TURNSTILE: 'turnstile', //       Turnstile widget (standalone, not necessarily a gate)
  RECAPTCHA: 'recaptcha', //       reCAPTCHA v2/v3/Enterprise widget
  HCAPTCHA: 'hcaptcha',
  DATADOME: 'datadome',
  PERIMETERX: 'perimeterx',
  AKAMAI: 'akamai',
  IMPERVA: 'imperva',
  AWS_WAF: 'aws-waf',
  JS_SHELL: 'js-shell', //          SPA that ships an empty root; needs rendering
});

const STRONG = [
  [CHALLENGE.CLOUDFLARE_MANAGED, /__cf_chl_opt|cf-chl-|challenge-platform\/h\/|cf_chl_|cdn-cgi\/challenge-platform|[Jj]ust a moment\.\.\./],
  [CHALLENGE.CLOUDFLARE_MANAGED, /cf-mitigated/i], // header value, matched below
  [CHALLENGE.TURNSTILE, /challenges\.cloudflare\.com\/turnstile|cf-turnstile|turnstile\.render|data-sitekey=[^&"']{20,}/],
  [CHALLENGE.RECAPTCHA, /www\.google\.com\/recaptcha|recaptcha\/api\.js|grecaptcha\.(execute|render)|g-recaptcha/],
  [CHALLENGE.HCAPTCHA, /hcaptcha\.com\/1\/api\.js|h-captcha|data-hcaptcha/],
  [CHALLENGE.DATADOME, /captcha-delivery\.com|datadome\.co\/[0-9a-f]{8}/i],
  [CHALLENGE.PERIMETERX, /px-captcha|_pxhd|perimeterx|px\.cloudflare/i],
  [CHALLENGE.AKAMAI, /_abck|bm_sz|AkamaiGHost|akam/i],
  [CHALLENGE.IMPERVA, /_Incapsula_Resource|visid_incap|incap_ses/],
  [CHALLENGE.AWS_WAF, /aws-waf-token|challenge\.js|AwsWafIntegration/i],
];

const WEAK = [
  [CHALLENGE.CLOUDFLARE_MANAGED, /enable JavaScript and cookies to continue|Checking your browser before accessing/],
  [CHALLENGE.TURNSTILE, /turnstile/i],
  [CHALLENGE.RECAPTCHA, /recaptcha/i],
  [CHALLENGE.HCAPTCHA, /hcaptcha/i],
  [CHALLENGE.DATADOME, /datadome/i],
  [CHALLENGE.PERIMETERX, /\bhuman\b.*\bpress\b.*\bhold\b|press and hold/i],
];

const JS_SHELL = [
  /<div id="(root|app|__next|__nuxt)"[^>]*>\s*<\/div>/i,
  /<noscript[^>]*>[^<]*(enable JavaScript|JavaScript is disabled)/i,
  /window\.__NUXT__|window\.__NEXT_DATA__|window\.__INITIAL_STATE__/i,
  /<script[^>]+type="module"[^>]+src=/i,
];

const SKIP_CONTENT_TYPES = /^(image\/|video\/|audio\/|application\/(pdf|zip|octet-stream|wasm|font)|font\/)/i;

/**
 * @param {{status:number, headers:Headers|Record<string,string>, body:string, contentType?:string}} res
 * @returns {{challenge:string|null, confidence:'high'|'medium'|'low'|null, reasons:string[], needsRender:boolean, blocked:boolean}}
 */
export function classify(res) {
  const status = res.status || 0;
  const h = res.headers instanceof Headers ? res.headers : new Headers(res.headers || {});
  const ctype = res.contentType || h.get('content-type') || '';
  const body = typeof res.body === 'string' ? res.body : '';
  const reasons = [];

  if (SKIP_CONTENT_TYPES.test(ctype)) {
    return { challenge: null, confidence: null, reasons: ['binary content'], needsRender: false, blocked: false };
  }

  // Status-only walls. 403/429 alone is not proof of a challenge, so it is a
  // signal that only counts together with a body marker.
  const cfMitigated = h.get('cf-mitigated');
  const server = (h.get('server') || '').toLowerCase();

  const strongHits = new Set();
  const weakHits = new Set();
  const sample = body.slice(0, 200_000);

  for (const [name, re] of STRONG) if (re.test(sample)) strongHits.add(name);
  for (const [name, re] of WEAK) if (re.test(sample)) weakHits.add(name);

  if (/text\/html/i.test(ctype) && !/cloudflare/i.test(server) && (status === 403 || status === 429)) {
    reasons.push(`status ${status}`);
  }

  const cfTurnstileChallenge = /challenges\.cloudflare\.com\/turnstile/.test(sample);

  // A page that merely *embeds* a widget alongside real content is not a gate.
  // Measure visible text, not markup: a content page with an inline widget has
  // thousands of characters of prose; a gate has a headline and a script.
  const visibleText = sample.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const bodyLength = sample.length;
  const gateStatus = status === 403 || status === 429 || status === 503;
  const looksLikeGate = gateStatus || visibleText.length < 400;

  if (strongHits.size === 0 && weakHits.size < 2) {
    const shell = JS_SHELL.some((re) => re.test(sample)) && bodyLength < 40_000;
    if (shell) reasons.push('SPA shell');
    return {
      challenge: shell ? CHALLENGE.JS_SHELL : CHALLENGE.NONE,
      confidence: shell ? 'low' : null,
      reasons,
      needsRender: shell,
      blocked: gateStatus && !shell,
    };
  }

  const picked = pick(strongHits, weakHits);
  let confidence = strongHits.has(picked) ? 'high' : 'medium';
  if (!looksLikeGate && picked !== CHALLENGE.TURNSTILE && picked !== CHALLENGE.RECAPTCHA) confidence = 'low';

  // Turnstile embedded in a full page is a widget to solve, not a wall to break.
  const isWidgetOnly = cfTurnstileChallenge && !looksLikeGate && !cfMitigated;

  return {
    challenge: picked,
    confidence,
    reasons,
    needsRender: !isWidgetOnly,
    blocked: Boolean(cfMitigated) || gateStatus,
  };
}

function pick(strongHits, weakHits) {
  const order = [
    CHALLENGE.CLOUDFLARE_MANAGED,
    CHALLENGE.TURNSTILE,
    CHALLENGE.DATADOME,
    CHALLENGE.PERIMETERX,
    CHALLENGE.AKAMAI,
    CHALLENGE.IMPERVA,
    CHALLENGE.RECAPTCHA,
    CHALLENGE.HCAPTCHA,
    CHALLENGE.AWS_WAF,
  ];
  for (const c of order) {
    if (strongHits.has(c) || weakHits.has(c)) return c;
  }
  return [...strongHits][0] || [...weakHits][0] || null;
}

/** Which solvers are worth trying for a challenge, cheapest first. */
export function solverPlan(challenge) {
  switch (challenge) {
    case CHALLENGE.TURNSTILE:
    case CHALLENGE.CLOUDFLARE_MANAGED:
      // Turnstile issues its token from inside a real page context. There is no
      // request-only shortcut that survives the TLS/fingerprint binding, so the
      // only plan is: render in a browser and let the widget self-issue, with a
      // human handoff if it does not.
      return ['browser:wait-widget', 'human:handoff'];
    case CHALLENGE.RECAPTCHA:
      return ['browser:audio', 'human:handoff'];
    case CHALLENGE.HCAPTCHA:
      return ['browser:audio', 'human:handoff'];
    case CHALLENGE.IMPERVA:
    case CHALLENGE.AWS_WAF:
      return ['browser:challenge-js', 'human:handoff'];
    case CHALLENGE.JS_SHELL:
      return ['render'];
    default:
      return [];
  }
}
