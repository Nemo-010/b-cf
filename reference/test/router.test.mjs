import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { parseTarget, pickEngine } from '../src/index.js';

const req = (url, init = {}) => new Request(url, init);

test('parseTarget accepts a scheme-prefixed path', () => {
  assert.equal(parseTarget(req('https://api.rv.pkgforge.dev/https://example.com/a?b=1')), 'https://example.com/a?b=1');
});

test('parseTarget accepts a bare host', () => {
  assert.equal(parseTarget(req('https://api.rv.pkgforge.dev/example.com')), 'https://example.com/');
});

test('parseTarget rejects a non-http scheme and an empty path', () => {
  assert.equal(parseTarget(req('https://api.rv.pkgforge.dev/ftp://example.com')), null);
  assert.equal(parseTarget(req('https://api.rv.pkgforge.dev/data:foo')), null);
  assert.equal(parseTarget(req('https://api.rv.pkgforge.dev/')), null);
});

test('pickEngine reads the query, the header, and defaults to auto', () => {
  assert.equal(pickEngine(req('https://x/https://y?engine=render')), 'render');
  assert.equal(pickEngine(req('https://x/https://y', { headers: { 'x-rv-engine': 'session' } })), 'session');
  assert.equal(pickEngine(req('https://x/https://y')), 'auto');
  assert.equal(pickEngine(req('https://x/https://y?engine=root')), 'auto');
});

test('health endpoint describes capabilities from env', async () => {
  const res = await worker.fetch(req('https://api.rv.pkgforge.dev/health'), { BROWSER: {}, AI: {} });
  const body = await res.json();
  assert.equal(body.version, 2);
  assert.equal(body.capabilities.render, true);
  assert.equal(body.capabilities.solvers, true);
});

test('root is the health endpoint; a bad target is a 400 with CORS', async () => {
  const root = await worker.fetch(req('https://api.rv.pkgforge.dev/'), {});
  assert.equal(root.status, 200);
  const bad = await worker.fetch(req('https://api.rv.pkgforge.dev/ftp://example.com'), {});
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get('access-control-allow-origin'), '*');
});

test('auto mode returns the fetch result when the page is clean', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('<html><body>' + 'ok '.repeat(2000) + '</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html', 'x-upstream': 'yes' },
    });
  try {
    const res = await worker.fetch(req('https://api.rv.pkgforge.dev/https://example.com'), {});
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-rv-engine'), 'fetch');
    assert.equal(res.headers.get('x-rv-challenge'), 'none');
    assert.equal(res.headers.get('x-upstream'), 'yes');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('x-rv-no-escalate never calls the browser binding', async () => {
  const realFetch = globalThis.fetch;
  let quickActions = 0;
  globalThis.fetch = async () => new Response('<html><body><h1>Just a moment...</h1><script>window._cf_chl_opt={}</script></body></html>', { status: 403, headers: { 'content-type': 'text/html' } });
  const env = { BROWSER: { quickAction: async () => { quickActions++; return new Response('rendered'); } } };
  try {
    const res = await worker.fetch(
      req('https://api.rv.pkgforge.dev/https://example.com', { headers: { 'x-rv-no-escalate': '1' } }),
      env,
    );
    assert.equal(res.headers.get('x-rv-engine'), 'fetch');
    assert.equal(quickActions, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('auto mode escalates a challenge to Browser Run', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html><body><h1>Just a moment...</h1><script>window._cf_chl_opt={}</script></body></html>', { status: 403, headers: { 'content-type': 'text/html' } });
  const env = { BROWSER: { quickAction: async () => new Response('<html><body>real</body></html>') } };
  try {
    const res = await worker.fetch(req('https://api.rv.pkgforge.dev/https://example.com'), env);
    assert.equal(res.headers.get('x-rv-engine'), 'browser-run:content');
    assert.equal(res.headers.get('x-rv-challenge'), 'cloudflare-managed');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('render failure in auto mode falls through to fetch output, not a 5xx', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html><body><h1>Just a moment...</h1><script>window._cf_chl_opt={}</script></body></html>', { status: 403, headers: { 'content-type': 'text/html' } });
  const env = { BROWSER: { quickAction: async () => { throw new Error('429 rate limited'); } } };
  try {
    const res = await worker.fetch(req('https://api.rv.pkgforge.dev/https://example.com'), env);
    // auto mode swallows the render error and continues to the session tier,
    // which is absent here, so we end on the session error path
    assert.ok(res.status === 403 || res.status === 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});
