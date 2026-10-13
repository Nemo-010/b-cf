import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserHeaders, orderedBrowserHeaderPairs, PROFILES, STRIP_REQUEST_HEADERS } from '../src/lib/profiles.js';

test('header order matches the b-ids capture for chrome-155-linux', () => {
  // Assert on the ordered pairs, not on Headers.keys(): Node's undici sorts
  // header keys, workerd does not. The order we build is what we send.
  const pairs = orderedBrowserHeaderPairs(PROFILES['chrome-155-linux'], {});
  assert.deepEqual(pairs.map(([k]) => k), PROFILES['chrome-155-linux'].headerOrder);
});

test('header values match the b-ids capture', () => {
  const p = PROFILES['chrome-155-linux'];
  const h = browserHeaders(p, {});
  assert.equal(h.get('user-agent'), p.userAgent);
  assert.equal(h.get('sec-ch-ua'), p.secChUa);
  assert.equal(h.get('sec-ch-ua-platform'), '"Linux"');
  assert.equal(h.get('accept-language'), 'en-US,en;q=0.9');
  assert.equal(h.get('accept-encoding'), 'gzip, deflate, br, zstd');
  assert.equal(h.get('sec-fetch-mode'), 'navigate');
});

test('extra headers append after the profile order and can override', () => {
  const pairs = orderedBrowserHeaderPairs(PROFILES['chrome-155-linux'], { authorization: 'Bearer x', accept: 'application/json' });
  const keys = pairs.map(([k]) => k);
  assert.equal(keys[keys.length - 1], 'authorization');
  assert.equal(pairs.find(([k]) => k === 'accept')[1], 'application/json');
  // overriding a value must not move the key
  assert.equal(keys.indexOf('accept'), 5);
});

test('non-navigate mode drops sec-fetch-user', () => {
  const h = browserHeaders(PROFILES['chrome-155-linux'], {}, { navigate: false });
  assert.equal(h.has('sec-fetch-user'), false);
});

test('client identity headers are on the strip list', () => {
  for (const name of ['x-forwarded-for', 'cf-connecting-ip', 'cf-ray', 'cf-worker', 'forwarded', 'cookie'.replace('cookie', 'via')]) {
    assert.equal(STRIP_REQUEST_HEADERS.has(name), true, name);
  }
});
