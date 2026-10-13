/**
 * api.rv.pkgforge.dev v2 — "Sphere Relay".
 *
 * URL contract (unchanged from v1 so existing callers keep working):
 *   https://api.rv.pkgforge.dev/https://host/path?query
 *
 * Engine selection, first match wins:
 *   ?engine=fetch|tls|render|markdown|session|auto (default: auto)
 *   X-Rv-Engine: fetch|tls|render|markdown|session|auto
 *   X-Rv-No-Escalate: 1                            (never render, fetch only)
 *
 * `tls` is tier 0s: a userland TLS + HTTP/2 transport over `cloudflare:sockets`
 * `connect()`, which is the only way to present a browser ClientHello from a
 * Worker. It is never chosen by `auto` — it costs a handshake of CPU per
 * request and needs `env.TLS_TRANSPORT` bound (see lib/engines/tls.js).
 *
 * Response always carries:
 *   X-Rv-Engine     which engine produced the body
 *   X-Rv-Ms         wall time in ms
 *   X-Rv-Challenge  detected gate, if any (empty when clean)
 *   X-Rv-Profile    browser profile used for header shaping
 *   X-Rv-Cache      hit | miss
 */

import { fetchEngine, viewResponse, relayHeaders } from './lib/engines/fetch.js';
import { quickAction, session } from './lib/engines/render.js';
import { tlsEngine, tlsEngineAvailable } from './lib/engines/tls.js';
import { classify, CHALLENGE, solverPlan } from './lib/detect.js';
import { runSolverStep } from './lib/solvers/index.js';
import { PROFILES, DEFAULT_PROFILE } from './lib/profiles.js';
import { cacheGet, cachePut, cacheable, cacheKey } from './lib/cache.js';

const ENGINES = new Set(['auto', 'fetch', 'tls', 'render', 'markdown', 'session']);

export function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
      'access-control-allow-headers': '*',
      'access-control-max-age': '86400',
    },
  });
}

export function parseTarget(request) {
  const url = new URL(request.url);
  const raw = url.pathname.slice(1) + url.search;
  if (!raw) return null;
  // Reject any other scheme rather than letting new URL() fold it into a path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) return null;
  // Accept both /https://x and /x (bare host gets https://).
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const target = new URL(candidate);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
    return target.toString();
  } catch {
    return null;
  }
}

export function pickEngine(request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('engine');
  const h = request.headers.get('x-rv-engine');
  const engine = (q || h || 'auto').toLowerCase();
  return ENGINES.has(engine) ? engine : 'auto';
}

function withMeta(res, meta) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(meta)) {
    if (v == null || v === '') continue;
    headers.set(k, String(v));
  }
  headers.set('access-control-allow-origin', '*');
  headers.set('x-rv-version', '2');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return handleOptions();

    // Health / discovery endpoint, so the Worker is self-documenting.
    const path = new URL(request.url).pathname;
    if (path === '/' || path === '/health') {
      return new Response(
        JSON.stringify({
          service: 'api.rv.pkgforge.dev',
          version: 2,
          engines: [...ENGINES],
          profiles: Object.keys(PROFILES),
          usage: 'https://api.rv.pkgforge.dev/https://example.com?engine=render',
          capabilities: {
            fetch: true,
            tls: tlsEngineAvailable(env),
            render: Boolean(env?.BROWSER),
            session: Boolean(env?.BROWSER),
            solvers: Boolean(env?.AI),
          },
        }),
        { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } },
      );
    }

    const target = parseTarget(request);
    if (!target) {
      return new Response('Invalid target URL. Usage: /https://example.com', {
        status: 400,
        headers: { 'access-control-allow-origin': '*' },
      });
    }

    const engine = pickEngine(request);
    const noEscalate = request.headers.get('x-rv-no-escalate') === '1';
    const profile = new URL(request.url).searchParams.get('profile') || DEFAULT_PROFILE;
    const ttl = Number(new URL(request.url).searchParams.get('cache') ?? 0);

    // ---- cache -------------------------------------------------------------
    const key = cacheKey(target, engine, profile);
    const cached = await cacheGet(key);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set('x-rv-cache', 'hit');
      return hit;
    }

    // ---- tier 0s: userland TLS --------------------------------------------
    // Explicit only. A caller asking for `tls` gets an error rather than a
    // silent downgrade to the transport they were trying to avoid.
    if (engine === 'tls') {
      const started = Date.now();
      const { res, engine: used } = await tlsEngine(env, {
        url: target,
        profile: PROFILES[profile],
        headers: {},
      });
      const out = withMeta(res, {
        'x-rv-engine': used,
        'x-rv-ms': Date.now() - started,
        'x-rv-challenge': 'none',
        'x-rv-profile': profile,
        'x-rv-cache': 'miss',
      });
      if (cacheable(request, { challenge: null, needsRender: false }) && ttl > 0) {
        ctx?.waitUntil?.(cachePut(key, out.clone(), ttl));
      }
      return out;
    }

    // ---- tier 0: fetch -----------------------------------------------------
    let verdict = null;
    if (engine === 'auto' || engine === 'fetch') {
      const { res, ms } = await fetchEngine(request, { url: target, profile });
      const view = await viewResponse(res);
      verdict = classify(view);

      const clean = !verdict.challenge && !verdict.needsRender;
      if (clean || engine === 'fetch' || noEscalate || !env?.BROWSER) {
        const out = withMeta(res, {
          'x-rv-engine': 'fetch',
          'x-rv-ms': ms,
          'x-rv-challenge': verdict.challenge || 'none',
          'x-rv-profile': profile,
          'x-rv-cache': 'miss',
        });
        if (cacheable(request, verdict) && ttl > 0) {
          ctx?.waitUntil?.(cachePut(key, out.clone(), ttl));
        }
        return out;
      }
    }

    // ---- tier 1: render ----------------------------------------------------
    if (engine !== 'session') {
      const action = engine === 'render' || engine === 'auto' ? 'content' : 'markdown';
      try {
        const { res, engine: used, ms } = await quickAction(env, {
          url: target,
          action,
          waitUntil: 'networkidle2',
          cacheTTL: 0,
        });
        const out = withMeta(res, {
          'x-rv-engine': used,
          'x-rv-ms': ms,
          'x-rv-challenge': verdict?.challenge || 'none',
          'x-rv-profile': 'browser-run-chromium',
          'x-rv-cache': 'miss',
        });
        if (ttl > 0) ctx?.waitUntil?.(cachePut(key, out.clone(), ttl));
        return out;
      } catch (err) {
        if (engine !== 'auto') {
          return new Response(`render failed: ${err.message}`, { status: 502 });
        }
      }
    }

    // ---- tier 2: session + solvers ----------------------------------------
    try {
      const plan = solverPlan(verdict?.challenge || CHALLENGE.JS_SHELL);
      const result = await session(env, {
        url: target,
        solve: async (sctx) => {
          const results = [];
          for (const step of plan) {
            const r = await runSolverStep(step, { ...sctx, challenge: verdict?.challenge, env });
            results.push(r);
            if (r.ok) break;
          }
          return results;
        },
      });
      const body = result.solved?.some((s) => s.ok) ? result.html : result.html;
      return new Response(body, {
        status: result.status,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'x-rv-engine': result.engine,
          'x-rv-ms': result.ms,
          'x-rv-challenge': verdict?.challenge || 'none',
          'x-rv-profile': 'browser-run-chromium',
          'x-rv-cache': 'miss',
          'access-control-allow-origin': '*',
          'x-rv-version': '2',
        },
      });
    } catch (err) {
      return new Response(`session failed: ${err.message}`, { status: 502 });
    }
  },
};

export { fetchEngine, quickAction, session, classify, runSolverStep, relayHeaders };
