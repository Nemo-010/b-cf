// Properties of the ClientHello the proof client builds, asserted offline.
//
// The point of `tools/tls13-client.mjs` is that a raw byte stream lets a
// program choose its own handshake. Two of those choices are load-bearing for
// the argument in RESEARCH.md section 2, Layer 1, and both are easy to believe
// without checking:
//
//   1. The chrome profile shuffles its extension order per connection, the way
//      Chrome does. That means its JA3 changes from handshake to handshake
//      while its JA4 does not -- the empirical reason the document compares
//      fingerprints with JA4. If this test ever fails, `proofs/09` has stopped
//      being a sample of a randomised distribution and the reasoning needs
//      revisiting.
//   2. The minimal profile's order is fixed, so the two profiles differ in
//      extension order as well as extension set.
//
// It also pins GREASE on/off, since a GREASE value that leaked into the
// fingerprint comparisons would make them meaningless.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PROFILES, buildClientHello } from '../../tools/tls13-client.mjs';

const GREASE = new Set(
  [0x0a, 0x1a, 0x2a, 0x3a, 0x4a, 0x5a, 0x6a, 0x7a, 0x8a, 0x9a, 0xaa, 0xba, 0xca, 0xda, 0xea, 0xfa]
    .map((v) => (v << 8) | v),
);

// `host` is not part of the profile: the caller supplies it for the SNI. The
// build is otherwise a pure function of the profile object.
const build = (name, n) => Array.from(
  { length: n },
  () => buildClientHello({ host: 'tls.peet.ws', ...PROFILES[name] }),
);

test('chrome profile: extension set is constant, order is not', () => {
  const hellos = build('chrome', 64);
  const sets = new Set(hellos.map((h) => [...h.order].sort((a, b) => a - b).join(',')));
  const orders = new Set(hellos.map((h) => h.order.join(',')));

  assert.equal(sets.size, 1, 'the extension set must not change between connections');
  assert.ok(orders.size > 1, 'the extension order must vary; Chrome shuffles it per connection');
  const got = [...sets][0].split(',').map(Number);
  const declared = [...PROFILES.chrome.extensions].sort((a, b) => a - b);

  assert.equal(got.length, 15, '13 declared plus two GREASE slots');
  assert.deepEqual(got.filter((v) => !GREASE.has(v)), declared);
  assert.equal(got.filter((v) => GREASE.has(v)).length, 2, 'exactly two GREASE extensions');
});

test('minimal profile: extension set and order are both constant', () => {
  const hellos = build('minimal', 64);
  const orders = new Set(hellos.map((h) => h.order.join(',')));

  assert.equal(orders.size, 1, 'the minimal profile declares a fixed order and must not shuffle');
  assert.equal([...orders][0], PROFILES.minimal.extensions.join(','));
});

test('the two profiles differ in extension order, not only in content', () => {
  const chrome = new Set(build('chrome', 32).map((h) => h.order.join(',')));
  const minimal = [...build('minimal', 1)[0].order].join(',');
  assert.ok(!chrome.has(minimal), 'chrome must never emit the minimal profile order');
});

test('GREASE is present exactly when declared', () => {
  const hasGrease = (h) => h.suites.some((s) => GREASE.has(s));
  assert.ok(build('chrome', 4).every(hasGrease), 'chrome declares GREASE');
  assert.ok(build('minimal', 4).every((h) => !hasGrease(h)), 'minimal must not');
});

test('the chrome profile holds 16 cipher suites and 15 extensions', () => {
  const h = buildClientHello({ host: 'tls.peet.ws', ...PROFILES.chrome });
  assert.equal(h.suites.length, 16, '15 declared plus one GREASE suite');
  assert.equal(h.order.length, 15, '13 declared plus two GREASE extensions');
});
