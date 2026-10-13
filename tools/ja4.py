#!/usr/bin/env python3
"""JA4 fingerprint from a raw TLS ClientHello (hex). Implements the FoxIO JA4 spec:
JA4_a = t<ver><sni d|i><2-digit cipher count><2-digit ext count><alpn>
JA4_b = sha256(sorted non-GREASE cipher hex, comma-joined)[:12]
JA4_c = sha256(sorted non-GREASE ext hex excluding SNI + '_' + sigalgs hex)[:12]
"""
import hashlib, sys

GREASE = lambda x: (x & 0x0f0f) == 0x0a0a and (x >> 8) == (x & 0xff)

def parse(ch):
    p = 5
    hs_len = int.from_bytes(ch[p+1:p+4], 'big')
    body = ch[p+4:p+4+hs_len]
    o = 0; ver = int.from_bytes(body[o:o+2], 'big'); o += 2 + 32
    sid = body[o]; o += 1 + sid
    cl = int.from_bytes(body[o:o+2], 'big'); o += 2
    ciphers = [int.from_bytes(body[o+i:o+i+2], 'big') for i in range(0, cl, 2)]; o += cl
    o += 1 + body[o]
    exts = []
    if o < len(body):
        et = int.from_bytes(body[o:o+2], 'big'); o += 2
        end = o + et
        while o + 4 <= end:
            t = int.from_bytes(body[o:o+2], 'big'); l = int.from_bytes(body[o+2:o+4], 'big')
            exts.append((t, body[o+4:o+4+l])); o += 4 + l
    return ver, ciphers, exts

def ja4(ch):
    ver, ciphers, exts = parse(ch)
    ed = {t: v for t, v in exts}
    sni = 0 in ed
    ver = 0x0303
    if 43 in ed and len(ed[43]) >= 3:
        raw = ed[43]; n = raw[0]
        vs = [int.from_bytes(raw[1+i:3+i], 'big') for i in range(0, n, 2)]
        vs = [v for v in vs if not GREASE(v)]
        if vs:
            ver = vs[0]
    ver_s = {0x0304: '13', 0x0303: '12', 0x0301: '10'}.get(ver, '00')
    alpn = '00'
    if 16 in ed and len(ed[16]) >= 5:
        alpn = ed[16][3:5].decode('latin1')
    cs = [c for c in ciphers if not GREASE(c)]
    es = [t for t, _ in exts if not GREASE(t)]
    sig = []
    if 13 in ed:
        raw = ed[13]; n = int.from_bytes(raw[:2], 'big')
        sig = [raw[2+i:4+i].hex() for i in range(0, n, 2)]
    a = f"t{ver_s}{'d' if sni else 'i'}{len(cs):02d}{len(es):02d}{alpn}"
    b = hashlib.sha256(",".join(f"{c:04x}" for c in sorted(cs)).encode()).hexdigest()[:12]
    ext_no_sni = sorted(t for t in es if t != 0)
    c = hashlib.sha256((",".join(f"{t:04x}" for t in ext_no_sni) + "_" + ",".join(sig)).encode()).hexdigest()[:12]
    return f"{a}_{b}_{c}", a, b, c, sorted(cs), ext_no_sni, sig

if __name__ == '__main__':
    ch = bytes.fromhex(open(sys.argv[1]).read().strip())
    j, a, b, c, cs, es, sig = ja4(ch)
    print("ja4        =", j)
    print("ciphers    =", ",".join(f"{x:04x}" for x in cs))
    print("extensions =", ",".join(f"{x:04x}" for x in es))
    print("sigalgs    =", ",".join(sig))
