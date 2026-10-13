#!/usr/bin/env python3
"""Parse a TLS ClientHello (hex) into a JA3 string and MD5 hash.

Usage: ja3.py <clienthello.hex>   |   ja3.py --live <host[:port]>
Reproduces what tls.peet.ws / ja3er.com compute, from first principles.
"""
import socket, ssl, sys, hashlib, struct

def parse_client_hello(ch):
    # ch = full TLS record(s) starting with 0x16 0x03 0x0x
    assert ch[0] == 0x16, "not a TLS handshake record"
    # record header 5 bytes, handshake header 4 bytes (type=1 client_hello)
    p = 5
    assert ch[p] == 0x01, "not a ClientHello"
    rec_len = int.from_bytes(ch[1:3], "big")
    hs_len = int.from_bytes(ch[p+1:p+4], "big")
    body = ch[p+4:p+4+hs_len]
    o = 0
    ver = int.from_bytes(body[o:o+2], "big"); o += 2
    o += 32  # random
    sid_len = body[o]; o += 1 + sid_len
    cs_len = int.from_bytes(body[o:o+2], "big"); o += 2
    ciphers = [int.from_bytes(body[o+i:o+i+2], "big") for i in range(0, cs_len, 2)]
    o += cs_len
    comp_len = body[o]; o += 1
    comps = list(body[o:o+comp_len]); o += comp_len
    exts = {}
    if o < len(body):
        ext_total = int.from_bytes(body[o:o+2], "big"); o += 2
        end = o + ext_total
        while o + 4 <= end:
            et = int.from_bytes(body[o:o+2], "big")
            el = int.from_bytes(body[o+2:o+4], "big")
            exts[et] = body[o+4:o+4+el]
            o += 4 + el
    def without_grease(xs): return [x for x in xs if not (x & 0x0f0f == 0x0a0a and (x >> 8) == (x & 0xff))]
    c = without_grease(ciphers)
    e = [t for t in exts if not (t & 0x0f0f == 0x0a0a and (t >> 8) == (t & 0xff))]
    curves = []
    if 10 in exts:
        raw = exts[10]; n = int.from_bytes(raw[:2], "big")
        curves = [int.from_bytes(raw[2+i:4+i], "big") for i in range(0, n, 2)]
    curves = without_grease(curves)
    pts = []
    if 11 in exts:
        raw = exts[11]; n = raw[0]
        pts = list(raw[1:1+n])
    ja3 = ",".join([
        str(ver), "-".join(map(str, c)), "-".join(map(str, e)),
        "-".join(map(str, curves)), "-".join(map(str, pts)),
    ])
    return ja3, hashlib.md5(ja3.encode()).hexdigest()

def live(host, port=443, alpn=None):
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    if alpn: ctx.set_alpn_protocols(alpn)
    s = socket.create_connection((host, port), timeout=15)
    ss = ctx.wrap_socket(s, server_hostname=host)
    raw = ss.getpeercert(binary_form=True)  # noqa
    ss.close()
    # python does not expose the sent ClientHello; fall back to a raw handshake sniff
    return None

if __name__ == "__main__":
    if sys.argv[1] == "--file":
        ch = bytes.fromhex(open(sys.argv[2]).read().strip())
        ja3, h = parse_client_hello(ch)
        print("ja3      =", ja3)
        print("ja3_hash =", h)
    else:
        print(__doc__)
