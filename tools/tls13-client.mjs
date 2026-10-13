#!/usr/bin/env node
/**
 * Minimal TLS 1.3 client with a controllable ClientHello.
 *
 * This exists to settle one question empirically: can a program that only has a
 * raw TCP byte stream choose the fingerprint an origin sees? If yes, then
 * "a Worker cannot control its TLS fingerprint" is false — `cloudflare:sockets`
 * `connect({ secureTransport: "off" })` is a raw byte stream, and the runtime's
 * own TLS stack is simply not used.
 *
 * It is deliberately small: X25519 only, AES-128-GCM only, no certificate
 * verification (there is nothing to protect here — we are reading our own
 * reflected fingerprint back from tls.peet.ws). Do not reuse this for anything
 * that needs to authenticate a peer.
 *
 *   node tools/tls13-client.mjs                     # both profiles, compare
 *   node tools/tls13-client.mjs --profile chrome    # one profile, raw JSON
 */

import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';

// ---------------------------------------------------------------- encoding ---

const u8 = (n) => Buffer.from([n & 0xff]);
const u16 = (n) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const u24 = (n) => Buffer.from([(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
const cat = (...bs) => Buffer.concat(bs);
const vec8 = (b) => cat(u8(b.length), b);
const vec16 = (b) => cat(u16(b.length), b);

const GREASE = [0x0a0a, 0x1a1a, 0x2a2a, 0x3a3a, 0x4a4a, 0x5a5a, 0x6a6a, 0x7a7a,
                0x8a8a, 0x9a9a, 0xaaaa, 0xbaba, 0xcaca, 0xdada, 0xeaea, 0xfafa];
const isGrease = (v) => (v & 0x0f0f) === 0x0a0a && v >>> 8 === (v & 0xff);
const grease = (n) => GREASE[n % GREASE.length];

// Exported for the known-answer tests in test/tls13-kat.test.mjs: the key
// schedule and record layer are checked against RFC 8448 there.
export { SUITES, kdfFor, keys, seal, open, nonce };

// ---------------------------------------------------------------- profiles ---

/**
 * Two deliberately different identities. The point is not that either is a
 * perfect Chrome; it is that the bytes are ours, so the fingerprint is a
 * parameter and not a property of the runtime.
 */
export const PROFILES = {
  // Chrome 155-ish: the 15 suites from the b-ids capture, Chrome's 16-extension
  // set, Chrome's signature_algorithms order, GREASE, shuffled extension order.
  chrome: {
    name: 'chrome-like',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    grease: true,
    alpn: ['http/1.1'],
    ciphers: [0x1301, 0x1302, 0x1303, 0xc02b, 0xc02f, 0xc02c, 0xc030, 0xcca9,
              0xcca8, 0xc013, 0xc014, 0x009c, 0x009d, 0x002f, 0x0035],
    groups: [0x001d, 0x0017, 0x0018],
    sigalgs: [0x0403, 0x0503, 0x0603, 0x0804, 0x0805, 0x0806, 0x0401, 0x0501, 0x0601],
    extensions: [0x0000, 0x0017, 0xff01, 0x000a, 0x000b, 0x0023, 0x0010, 0x000d,
                 0x0012, 0x0033, 0x002d, 0x002b, 0x001b],
  },
  // A different client identity entirely: different suite set, different
  // extension set, different signature_algorithms, no GREASE, fixed order.
  minimal: {
    name: 'minimal',
    userAgent: 'minimal-tls13-client/1.0',
    grease: false,
    alpn: ['http/1.1'],
    ciphers: [0x1301, 0x1302, 0x1303],
    groups: [0x001d],
    sigalgs: [0x0804, 0x0403, 0x0503],
    extensions: [0x0000, 0x000a, 0x000b, 0x000d, 0x0010, 0x002b, 0x0033],
  },
};

// -------------------------------------------------------------- clienthello ---

export function buildClientHello(p) {
  const random = crypto.randomBytes(32);
  const sessionId = crypto.randomBytes(32); // Chrome sends a 32-byte legacy id

  let suites = [...p.ciphers];
  if (p.grease) suites = [grease(0), ...suites];

  const groups = p.grease ? [grease(1), ...p.groups] : [...p.groups];
  const versions = p.grease ? [grease(2), 0x0304, 0x0303] : [0x0304, 0x0303];

  const sigalgs = p.sigalgs.map(u16);
  const ext = (type, body) => cat(u16(type), vec16(body));

  // X25519 key pair. Node hands us SPKI/PKCS8; we need the raw 32-byte halves.
  const kp = crypto.generateKeyPairSync('x25519');
  const pubRaw = kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);

  const byType = {
    // SNI: ServerNameList = u16(total) + [ name_type u8=0, u16(len), name ]
    0x0000: ext(0x0000, vec16(cat(u8(0), vec16(Buffer.from(p.host))))),
    0x0017: ext(0x0017, Buffer.alloc(0)),                                     // extended_master_secret
    0xff01: ext(0xff01, u8(0)),                                               // renegotiation_info
    0x000a: ext(0x000a, vec16(cat(...groups.map(u16)))),                      // supported_groups
    0x000b: ext(0x000b, cat(u8(1), u8(0))),                                       // ec_point_formats
    0x0023: ext(0x0023, Buffer.alloc(0)),                                     // session_ticket
    0x0010: ext(0x0010, vec16(cat(...p.alpn.map((a) => vec8(Buffer.from(a)))))), // ALPN
    0x000d: ext(0x000d, vec16(cat(...sigalgs))),                              // signature_algorithms
    0x0012: ext(0x0012, Buffer.alloc(0)),                                     // signed_certificate_timestamp
    0x002d: ext(0x002d, cat(u8(1), u8(1))),                                       // psk_key_exchange_modes
    0x002b: ext(0x002b, vec8(cat(...versions.map(u16)))),                     // supported_versions
    0x001b: ext(0x001b, cat(u8(2), u16(0x0002))),                                 // compress_certificate
    0x0033: ext(0x0033, vec16(cat(u16(0x001d), vec16(pubRaw)))),                  // key_share (x25519)
  };

  let order = [...p.extensions];
  if (p.grease) {
    // Chrome shuffles its extension order per connection, GREASE first (empty)
    // and last (a single zero byte).
    for (let i = order.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const gFirst = grease(3);
    const gLast = grease(4);
    byType[gFirst] = ext(gFirst, Buffer.alloc(0));
    byType[gLast] = ext(gLast, u8(0));
    order = [gFirst, ...order, gLast];
  }
  const exts = cat(...order.map((t) => byType[t] ?? (() => { throw new Error(`no encoder for ext 0x${t.toString(16)}`); })()));

  const body = cat(
    u16(0x0303), random,
    vec8(sessionId),
    vec16(cat(...suites.map(u16))),
    vec8(u8(0)),
    vec16(exts),
  );
  const hello = cat(u8(0x01), u24(body.length), body);
  const record = cat(u8(22), u16(0x0301), vec16(hello));
  // `order` and `suites` are returned so a test can assert the properties this
  // profile exists to demonstrate: a stable extension *set*, a per-connection
  // shuffled *order* (which is what makes JA3 unstable and JA4 stable), and
  // GREASE present or absent as declared.
  return { record, hello, order: [...order], suites: [...suites], privateKey: kp.privateKey };
}

// ------------------------------------------------------------ key schedule ---

/**
 * TLS 1.3 cipher suites differ in hash as well as AEAD: 0x1302 is AES-256-GCM
 * with SHA-384, not SHA-256. Everything below the suite table is built from a
 * KDF bound to that suite's hash.
 */
const SUITES = {
  0x1301: { aead: 'aes-128-gcm', keyLen: 16, hash: 'sha256', hashLen: 32 },
  0x1302: { aead: 'aes-256-gcm', keyLen: 32, hash: 'sha384', hashLen: 48 },
  0x1303: { aead: 'chacha20-poly1305', keyLen: 32, hash: 'sha256', hashLen: 32 },
};

function kdfFor(suite) {
  const { hash, hashLen } = SUITES[suite];
  const H = (b) => crypto.createHash(hash).update(b).digest();
  const hmac = (k, d) => crypto.createHmac(hash, k).update(d).digest();
  const extract = (salt, ikm) => hmac(salt, ikm);
  const zero = Buffer.alloc(hashLen);

  function expandLabel(secret, label, ctx, len) {
    const full = Buffer.from(`tls13 ${label}`, 'ascii');
    const info = cat(u16(len), u8(full.length), full, u8(ctx.length), ctx);
    let t = Buffer.alloc(0);
    let okm = Buffer.alloc(0);
    for (let i = 1; okm.length < len; i++) {
      t = hmac(secret, cat(t, info, u8(i)));  // HKDF-Expand: T(i) = HMAC(PRK, T(i-1) | info | i)
      okm = cat(okm, t);
    }
    return okm.subarray(0, len);
  }

  const deriveSecret = (secret, label, transcript) =>
    expandLabel(secret, label, H(transcript), hashLen);

  return { H, hmac, extract, expandLabel, deriveSecret, zero, hashLen };
}

function keys(kdf, secret, suite) {
  const { keyLen } = SUITES[suite];
  return {
    suite,
    key: kdf.expandLabel(secret, 'key', Buffer.alloc(0), keyLen),
    iv: kdf.expandLabel(secret, 'iv', Buffer.alloc(0), 12),
  };
}

function nonce(iv, seq) {
  // RFC 8446 s5.3: the sequence number is a 64-bit integer, big-endian, left
  // padded to iv_length, XORed into the IV. Use BigInt: JavaScript's `>>`
  // masks the shift count to 5 bits, so `seq >> 32` silently becomes `seq >> 0`
  // and corrupts a second byte of the IV.
  const n = Buffer.from(iv);
  let s = BigInt(seq);
  for (let i = 0; i < 8; i++) {
    n[n.length - 1 - i] ^= Number(s & 0xffn);
    s >>= 8n;
  }
  return n;
}

function seal(keyset, seq, innerType, payload) {
  const inner = cat(payload, u8(innerType));
  const total = inner.length + 16;
  const hdr = cat(u8(23), u16(0x0303), u16(total));
  const cipher = crypto.createCipheriv(SUITES[keyset.suite].aead, keyset.key, nonce(keyset.iv, seq), { authTagLength: 16 });
  cipher.setAAD(hdr);
  const ct = cat(cipher.update(inner), cipher.final());
  return cat(hdr, ct, cipher.getAuthTag());
}

function open(keyset, seq, record) {
  const hdr = record.subarray(0, 5);
  const ct = record.subarray(5);
  const decipher = crypto.createDecipheriv(SUITES[keyset.suite].aead, keyset.key, nonce(keyset.iv, seq), { authTagLength: 16 });
  decipher.setAAD(hdr);
  decipher.setAuthTag(ct.subarray(ct.length - 16));
  const inner = cat(decipher.update(ct.subarray(0, ct.length - 16)), decipher.final());
  let i = inner.length - 1;
  while (i >= 0 && inner[i] === 0) i--;
  return { type: inner[i], payload: inner.subarray(0, i) };
}

// -------------------------------------------------------------- record loop ---

class Stream {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    socket.on('data', (d) => {
      if (process.env.DUMP_TLS) fs.appendFileSync(process.env.DUMP_TLS, d);
      this.buf = cat(this.buf, d);
      this.pump();
    });
    socket.on('close', () => this.pump(true));
    socket.on('error', (e) => this.fail(e));
  }
  fail(e) { const w = this.waiters; this.waiters = []; for (const x of w) x.reject(e); }
  pump() {
    while (this.waiters.length) {
      if (this.buf.length < 5) return;
      const len = (this.buf[3] << 8) | this.buf[4];
      if (this.buf.length < 5 + len) return;
      const rec = this.buf.subarray(0, 5 + len);
      this.buf = this.buf.subarray(5 + len);
      this.waiters.shift().resolve(rec);
    }
  }
  next() { return new Promise((resolve, reject) => { this.waiters.push({ resolve, reject }); this.pump(); }); }
}

async function readHandshakeMessages(stream, keyset, state) {
  const out = [];
  while (true) {
    const rec = await stream.next();
    if (!rec) throw new Error('connection closed during handshake');
    if (rec[0] === 20) continue; // ChangeCipherSpec, ignored in TLS 1.3
    if (rec[0] === 22 && !keyset) { out.push(rec.subarray(5)); continue; }
    const { type, payload } = open(keyset, state.seq++, rec);
    if (type === 22) out.push(payload);
    else throw new Error(`unexpected inner content type ${type}`);
    // Return once a Finished (0x14) has been seen.
    const joined = cat(...out);
    let p = 0;
    while (p + 4 <= joined.length) {
      const mt = joined[p];
      const ml = (joined[p + 1] << 16) | (joined[p + 2] << 8) | joined[p + 3];
      if (p + 4 + ml > joined.length) break;
      p += 4 + ml;
      if (mt === 0x14) return out;
    }
  }
}

// ------------------------------------------------------------------- driver ---

export async function handshake({ host, port = 443, profile, path = '/api/all', timeout = 15000 }) {
  const p = { ...profile, host };
  const { record, hello, privateKey } = buildClientHello(p);

  const socket = net.connect({ host, port });
  socket.setTimeout(timeout, () => socket.destroy(new Error('timeout')));
  await new Promise((res, rej) => { socket.once('connect', res); socket.once('error', rej); });

  const stream = new Stream(socket);
  socket.write(record);

  // --- ServerHello ---------------------------------------------------------
  const shRec = await stream.next();
  if (shRec[0] === 21) {
    const level = shRec[5] === 2 ? 'fatal' : 'warning';
    throw new Error(`server sent a TLS alert: ${level}, description ${shRec[6]}`);
  }
  const serverHello = shRec.subarray(5);
  const transcript = cat(hello, serverHello);

  const b = serverHello;
  let o = 4;                                  // handshake header
  o += 2 + 32;                                // legacy_version + random
  o += 1 + b[o];                              // session id
  const cipherSuite = (b[o] << 8) | b[o + 1]; o += 2;
  o += 1;                                     // compression
  const extLen = (b[o] << 8) | b[o + 1]; o += 2;
  const extEnd = o + extLen;
  let serverShare = null;
  while (o < extEnd) {
    const t = (b[o] << 8) | b[o + 1];
    const l = (b[o + 2] << 8) | b[o + 3];
    if (t === 0x0033) {
      const group = (b[o + 4] << 8) | b[o + 5];
      const klen = (b[o + 6] << 8) | b[o + 7];
      if (group !== 0x001d) throw new Error(`server picked group ${group.toString(16)}, expected x25519`);
      serverShare = Buffer.from(b.subarray(o + 8, o + 8 + klen));
    }
    o += 4 + l;
  }
  if (!serverShare) throw new Error('no key_share in ServerHello');
  if (!SUITES[cipherSuite]) throw new Error(`server picked unsupported suite ${cipherSuite.toString(16)}`);

  // --- key schedule (RFC 8446 s7.1) ---------------------------------------
  const peerSpki = cat(Buffer.from('302a300506032b656e032100', 'hex'), serverShare);
  const peerKey = crypto.createPublicKey({ key: peerSpki, format: 'der', type: 'spki' });
  const shared = crypto.diffieHellman({ privateKey, publicKey: peerKey });

  const kdf = kdfFor(cipherSuite);
  const earlySecret = kdf.extract(kdf.zero, kdf.zero);
  const handshakeSecret = kdf.extract(kdf.deriveSecret(earlySecret, 'derived', Buffer.alloc(0)), shared);
  const cHs = kdf.deriveSecret(handshakeSecret, 'c hs traffic', transcript);
  const sHs = kdf.deriveSecret(handshakeSecret, 's hs traffic', transcript);

  // --- server flight -------------------------------------------------------
  const serverFlight = await readHandshakeMessages(stream, keys(kdf, sHs, cipherSuite), { seq: 0 });
  const transcriptThroughServer = cat(transcript, ...serverFlight);

  // --- client Finished -----------------------------------------------------
  const finishedKey = kdf.expandLabel(cHs, 'finished', Buffer.alloc(0), kdf.hashLen);
  const verifyData = kdf.hmac(finishedKey, kdf.H(transcriptThroughServer));
  const clientFinished = cat(u8(0x14), u24(kdf.hashLen), verifyData);
  socket.write(seal(keys(kdf, cHs, cipherSuite), 0, 22, clientFinished));

  // --- application keys ----------------------------------------------------
  const masterSecret = kdf.extract(kdf.deriveSecret(handshakeSecret, 'derived', Buffer.alloc(0)), kdf.zero);
  const cAp = kdf.deriveSecret(masterSecret, 'c ap traffic', transcriptThroughServer);
  const sAp = kdf.deriveSecret(masterSecret, 's ap traffic', transcriptThroughServer);

  // --- HTTP request over TLS ----------------------------------------------
  const req = Buffer.from(
    `GET ${path} HTTP/1.1\r\n` +
    `Host: ${host}\r\n` +
    `User-Agent: ${p.userAgent}\r\n` +
    'Accept: application/json\r\n' +
    'Accept-Encoding: identity\r\n' +
    'Connection: close\r\n\r\n',
  );
  socket.write(seal(keys(kdf, cAp, cipherSuite), 0, 23, req));

  // --- read the response ---------------------------------------------------
  let body = Buffer.alloc(0);
  let serverSeq = 0;
  let handshakeSeq = serverSeq;
  while (true) {
    let rec;
    try { rec = await stream.next(); } catch { break; }
    if (!rec) break;
    if (rec[0] === 21) continue;               // alert
    const { type, payload } = open(keys(kdf, sAp, cipherSuite), serverSeq++, rec);
    if (type === 23) body = cat(body, payload);
    else if (type === 22) handshakeSeq++;      // NewSessionTicket, decrypted and discarded
    else if (type === 21) break;               // close_notify
  }
  socket.destroy();

  const text = body.toString('utf8');
  const idx = text.indexOf('\r\n\r\n');
  return {
    profile: p.name,
    cipherSuite: `0x${cipherSuite.toString(16)}`,
    response: idx >= 0 ? text.slice(idx + 4) : text,
  };
}

// --------------------------------------------------------------------- main ---

if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv.includes('--profile')
    ? process.argv[process.argv.indexOf('--profile') + 1]
    : null;
  const host = process.argv.includes('--host')
    ? process.argv[process.argv.indexOf('--host') + 1]
    : 'tls.peet.ws';
  const path = process.argv.includes('--path')
    ? process.argv[process.argv.indexOf('--path') + 1]
    : '/api/all';
  const targets = which ? [which] : Object.keys(PROFILES);
  const results = [];
  for (const name of targets) {
    const r = await handshake({ host, profile: PROFILES[name], path });
    let fp = {};
    try {
      const j = JSON.parse(r.response);
      fp = {
        ip: j.ip,
        http_version: j.http_version,
        user_agent: j.user_agent,
        ja3: j.tls?.ja3,
        ja3_hash: j.tls?.ja3_hash,
        ja4: j.tls?.ja4,
        peetprint_hash: j.tls?.peetprint_hash,
        h2_akamai: j.http2?.akamai_fingerprint_hash ?? null,
        ciphers: (j.tls?.ciphers || []).length,
        extensions: (j.tls?.extensions || []).length,
      };
    } catch (e) {
      fp = { error: String(e.message), raw: r.response.slice(0, 300) };
    }
    results.push({ profile: r.profile, cipherSuite: r.cipherSuite, seenByServer: fp });
    console.log(`\n=== ${r.profile} (suite ${r.cipherSuite}) ===`);
    for (const [k, v] of Object.entries(fp)) console.log(`${k.padEnd(15)} ${v}`);
  }
  if (results.length === 2) {
    const [a, b] = results.map((r) => r.seenByServer);
    console.log('\n=== the control ===');
    console.log('ja4 differs :', a.ja4 !== b.ja4, `(${a.ja4} vs ${b.ja4})`);
    console.log('ja3 differs :', a.ja3_hash !== b.ja3_hash);
  }
}
