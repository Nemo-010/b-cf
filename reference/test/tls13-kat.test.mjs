// Known-answer tests for the minimal TLS 1.3 client in tools/tls13-client.mjs.
//
// The vectors come from RFC 8448 section 3, extracted by
// tools/rfc8448-extract.py rather than typed by hand. Two bugs that this file
// now pins down were found by running that client against real servers:
//
//   1. HKDF-Expand without the counter byte (every secret wrong).
//   2. `seq >> (8 * i)` in the AEAD nonce: JavaScript masks shift counts to
//      five bits, so i == 4 became `>> 0`, XORing a second IV byte. Only the
//      first record under a key decrypted.
//
//   and one from RFC 8446's cipher suite table:
//
//   3. 0x1302 is AES-256-GCM *with SHA-384*, not SHA-256.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

import { SUITES, kdfFor, keys, open, nonce } from '../../tools/tls13-client.mjs';

const K = JSON.parse(readFileSync(new URL('./vectors/tls13-kat.json', import.meta.url), 'utf8'));
const hex = (s) => Buffer.from(s, 'hex');
const empty = Buffer.alloc(0);

test('RFC 7748 X25519 vector', () => {
  const pkcs8 = (p) => Buffer.concat([hex('302e020100300506032b656e04220420'), hex(p)]);
  const spki = (p) => Buffer.concat([hex('302a300506032b656e032100'), hex(p)]);
  const a = crypto.createPrivateKey({ key: pkcs8(K.x25519.a_priv), format: 'der', type: 'pkcs8' });
  const b = crypto.createPublicKey({ key: spki(K.x25519.b_pub), format: 'der', type: 'spki' });
  assert.equal(
    crypto.createPublicKey(a).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'),
    K.x25519.a_pub,
  );
  assert.equal(crypto.diffieHellman({ privateKey: a, publicKey: b }).toString('hex'), K.x25519.shared);
});

test('RFC 8448 key schedule', () => {
  for (const suite of [0x1301, 0x1302, 0x1303]) {
    const kdf = kdfFor(suite);
    const early = kdf.extract(kdf.zero, kdf.zero);
    const derivedEarly = kdf.deriveSecret(early, 'derived', empty);
    // RFC 8448 only prints SHA-256 values, so check those against every suite
    // whose hash is SHA-256.
    if (SUITES[suite].hash === 'sha256') {
      assert.equal(early.toString('hex'), K.early_secret);
      assert.equal(derivedEarly.toString('hex'), K.derived_early);
    }
    // Sizes must follow the suite's hash.
    assert.equal(early.length, kdf.hashLen);
    assert.equal(derivedEarly.length, kdf.hashLen);
  }

  const kdf = kdfFor(0x1301);
  // With the RFC's ECDHE output as IKM, the whole chain must reproduce.
  const handshake = kdf.extract(hex(K.derived_early), hex(K.ecdh_ikm));
  assert.equal(handshake.toString('hex'), K.handshake_secret);
  assert.equal(kdf.deriveSecret(handshake, 'derived', empty).toString('hex'), K.derived_handshake);

  const ch = hex(K.transcript_ch_sh);
  assert.equal(kdf.expandLabel(handshake, 'c hs traffic', ch, 32).toString('hex'), K.c_hs_traffic);
  assert.equal(kdf.expandLabel(handshake, 's hs traffic', ch, 32).toString('hex'), K.s_hs_traffic);

  const master = kdf.extract(hex(K.derived_handshake), kdf.zero);
  assert.equal(master.toString('hex'), K.master_secret);
  const fin = hex(K.transcript_ch_sfin);
  assert.equal(kdf.expandLabel(master, 'c ap traffic', fin, 32).toString('hex'), K.c_ap_traffic);
  assert.equal(kdf.expandLabel(master, 's ap traffic', fin, 32).toString('hex'), K.s_ap_traffic);

  // Traffic keys, including the client handshake keys the RFC calls "same as
  // server handshake data read traffic keys".
  const cHs = hex(K.c_hs_traffic);
  const sHs = hex(K.s_hs_traffic);
  assert.equal(kdf.expandLabel(cHs, 'key', empty, 16).toString('hex'), K.c_hs_key);
  assert.equal(kdf.expandLabel(cHs, 'iv', empty, 12).toString('hex'), K.c_hs_iv);
  assert.equal(kdf.expandLabel(sHs, 'key', empty, 16).toString('hex'), K.s_hs_key);
  assert.equal(kdf.expandLabel(sHs, 'iv', empty, 12).toString('hex'), K.s_hs_iv);
  assert.equal(kdf.expandLabel(hex(K.c_ap_traffic), 'key', empty, 16).toString('hex'), K.c_ap_key);
  assert.equal(kdf.expandLabel(hex(K.s_ap_traffic), 'key', empty, 16).toString('hex'), K.s_ap_key);
  assert.equal(kdf.expandLabel(hex(K.s_ap_traffic), 'iv', empty, 12).toString('hex'), K.s_ap_iv);
});

test('AEAD nonce for sequence number 1 touches exactly one IV byte', () => {
  // Regression: `seq >> 32` must not alias to `seq >> 0`.
  const iv = hex(K.s_ap_iv);
  const n = nonce(iv, 1);
  const changed = [...n].map((b, i) => (b !== iv[i] ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(changed, [11], 'only the last byte may change for seq=1');
  assert.equal(n[11], iv[11] ^ 1);
  // And the high half of a 64-bit sequence number must land in bytes 4..7.
  const big = nonce(iv, 0x0000000100000001n);
  assert.equal(big[7], iv[7] ^ 1);
  assert.equal(big[11], iv[11] ^ 1);
});

test('RFC 8448 record layer, including a record at sequence number > 0', () => {
  const kdf = kdfFor(0x1301);
  const cases = [
    { name: 'server flight',    rec: K.rec_server_flight,   key: 's_hs', seq: 0, inner: 22, starts: '08000024' },
    { name: 'client Finished',  rec: K.rec_client_finished, key: 'c_hs', seq: 0, inner: 22, starts: '14000020' },
    { name: 'server ticket',    rec: K.rec_server_ticket,   key: 's_ap', seq: 0, inner: 22, starts: '040000c9' },
    { name: 'client app data',  rec: K.rec_client_app,      key: 'c_ap', seq: 0, inner: 23, starts: '00010203' },
    // This one is the whole point: s ap traffic, sequence number 1.
    { name: 'server app data',  rec: K.rec_server_app,      key: 's_ap', seq: 1, inner: 23, starts: '00010203' },
  ];
  for (const c of cases) {
    const keyset = keys(kdf, hex(K[`${c.key}_traffic`]), 0x1301);
    const rec = hex(c.rec);
    const out = open(keyset, c.seq, rec);
    assert.equal(out.type, c.inner, `${c.name}: inner content type`);
    assert.equal(out.payload.subarray(0, 4).toString('hex'), c.starts, `${c.name}: plaintext`);
  }
});

test('0x1302 is AES-256-GCM with SHA-384', () => {
  assert.deepEqual(SUITES[0x1302], {
    aead: 'aes-256-gcm', keyLen: 32, hash: 'sha384', hashLen: 48,
  });
  const kdf = kdfFor(0x1302);
  const secret = Buffer.alloc(48, 7);
  assert.equal(kdf.deriveSecret(secret, 'c ap traffic', empty).length, 48);
  assert.equal(keys(kdf, secret, 0x1302).key.length, 32);
  assert.equal(keys(kdf, secret, 0x1301).key.length, 16);
  // The two suites must not agree: a SHA-256 secret fed to SHA-384 differs.
  const a = kdfFor(0x1301).deriveSecret(Buffer.alloc(32, 7), 'x', empty).toString('hex');
  const b = kdfFor(0x1302).deriveSecret(Buffer.alloc(32, 7), 'x', empty).toString('hex');
  assert.notEqual(a, b);
});
