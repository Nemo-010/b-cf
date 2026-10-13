// Tier 0s: the userland-TLS seam. There is no TLS implementation here to test,
// so these tests pin down the contract around it: it is opt-in, it refuses
// rather than downgrading, and it shapes headers from the same profile the
// fetch engine uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { tlsEngine, tlsEngineAvailable } from '../src/lib/engines/tls.js';
import { PROFILES } from '../src/lib/profiles.js';

const req = (url, init = {}) => new Request(url, init);
const profile = PROFILES['chrome-155-linux'];

test('tlsEngineAvailable requires a transport with fetch()', () => {
  assert.equal(tlsEngineAvailable({}), false);
  assert.equal(tlsEngineAvailable({ TLS_TRANSPORT: {} }), false);
  assert.equal(tlsEngineAvailable({ TLS_TRANSPORT: { fetch: () => {} } }), true);
});

test('tlsEngine refuses without a transport instead of falling back', async () => {
  await assert.rejects(() => tlsEngine({}, { url: 'https://example.com', profile }), /TLS_TRANSPORT is not bound/);
  await assert.rejects(
    () => tlsEngine({ TLS_TRANSPORT: {} }, { url: 'https://example.com', profile }),
    /must expose fetch/,
  );
});

test('tlsEngine passes profile-shaped headers to the transport', async () => {
  let seen = null;
  const env = {
    TLS_TRANSPORT: {
      fetch: async (url, init) => {
        seen = { url, headers: init.headers };
        return new Response('ok', { status: 200 });
      },
    },
  };
  const { res, engine } = await tlsEngine(env, { url: 'https://example.com/a', profile });
  assert.equal(engine, 'tls');
  assert.equal(res.status, 200);
  assert.equal(seen.url, 'https://example.com/a');
  // Same helper as the fetch engine, so header values cannot drift apart.
  assert.equal(seen.headers.get('user-agent'), profile.userAgent);
  assert.equal(seen.headers.get('accept-language'), profile.acceptLanguage);
  assert.ok(seen.headers.get('sec-ch-ua-platform'));
});

test('auto never selects the tls engine', async () => {
  let calls = 0;
  const env = {
    TLS_TRANSPORT: { fetch: async () => (calls++, new Response('x')) },
  };
  // fetchEngine will fail (no network in the test), but the point is that the
  // tls transport was not the thing that ran.
  try {
    await worker.fetch(req('https://api.rv.pkgforge.dev/https://example.invalid/'), env);
  } catch {
    /* ignore */
  }
  assert.equal(calls, 0);
});

test('an explicit ?engine=tls with no transport is a hard error, not a downgrade', async () => {
  let body = '';
  let status = 0;
  try {
    const res = await worker.fetch(req('https://api.rv.pkgforge.dev/https://example.invalid/?engine=tls'), {});
    status = res.status;
    body = await res.text();
  } catch (err) {
    body = String(err.message);
  }
  // Either the worker surfaces it (thrown) or it becomes a 500; what must not
  // happen is a silent fetch() response.
  assert.ok(/TLS_TRANSPORT/.test(body) || status >= 500, `unexpected: ${status} ${body}`);
});

test('health endpoint reports the tls capability', async () => {
  const off = await (await worker.fetch(req('https://api.rv.pkgforge.dev/health'), {})).json();
  assert.equal(off.capabilities.tls, false);
  const on = await (
    await worker.fetch(req('https://api.rv.pkgforge.dev/health'), {
      TLS_TRANSPORT: { fetch: async () => new Response('') },
    })
  ).json();
  assert.equal(on.capabilities.tls, true);
  assert.ok(on.engines.includes('tls'));
});
