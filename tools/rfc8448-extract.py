#!/usr/bin/env python3
"""Extract the TLS 1.3 key-schedule and record vectors from RFC 8448 (section 3).

The RFC prints every intermediate value for one handshake, so the whole thing
can be used as a known-answer test. Hand-transcribing ~30 hex blocks invites
typos, so this pulls them straight out of the text.

    curl -O https://www.rfc-editor.org/rfc/rfc8448.txt
    python3 tools/rfc8448-extract.py rfc8448.txt > reference/test/vectors/tls13-kat.json
"""

import json
import re
import sys

HEX = re.compile(r"^[0-9a-f]{2}$")


def blocks(text):
    """Return [(offset, label, bytes)] for every `label: hex...` block."""
    out = []
    for m in re.finditer(r"^[ \t]{3,}([^:\n]{2,60}):[ \t]*(.*)$", text, re.M):
        acc = [int(t, 16) for t in m.group(2).split() if HEX.match(t)]
        j = m.end()
        if text[j:j + 1] == "\n":   # re.M puts $ just before the newline
            j += 1
        while j < len(text):
            nl = text.find("\n", j)
            if nl < 0:
                break
            s = text[j:nl].strip()
            if not s:
                break
            toks = s.split()
            if not all(HEX.match(t) for t in toks):
                break
            acc += [int(t, 16) for t in toks]
            j = nl + 1
        out.append((m.start(), m.group(1).strip(), bytes(acc)))
    return out


def collect(text):
    bl = blocks(text)
    out = {}

    def after(anchor, label, occurrence=0, key=None):
        start = text.index(anchor)
        hits = [v for pos, lab, v in bl if lab == label and pos > start]
        if len(hits) <= occurrence:
            raise SystemExit(f"not found: {label!r} #{occurrence} after {anchor!r}")
        if key:
            out[key] = hits[occurrence].hex()
        return hits[occurrence]

    after('extract secret "early"', "secret (32 octets)", key="early_secret")
    after('derive secret for handshake "tls13 derived"', "expanded (32 octets)", key="derived_early")
    after('extract secret "handshake"', "secret (32 octets)", key="handshake_secret")
    # The ECDHE output, printed as the IKM going into that extract.
    after('extract secret "handshake"', "IKM (32 octets)", key="ecdh_ikm")
    after('extract secret "master"', "secret (32 octets)", key="master_secret")
    after('derive secret for master "tls13 derived"', "expanded (32 octets)", key="derived_handshake")

    # Both directions print the same ClientHello..ServerHello transcript hash.
    out["transcript_ch_sh"] = after('derive secret "tls13 c hs traffic"', "hash (32 octets)").hex()
    after('derive secret "tls13 c hs traffic"', "expanded (32 octets)", key="c_hs_traffic")
    after('derive secret "tls13 s hs traffic"', "expanded (32 octets)", key="s_hs_traffic")
    out["transcript_ch_sfin"] = after('derive secret "tls13 c ap traffic"', "hash (32 octets)").hex()
    after('derive secret "tls13 c ap traffic"', "expanded (32 octets)", key="c_ap_traffic")
    after('derive secret "tls13 s ap traffic"', "expanded (32 octets)", key="s_ap_traffic")

    after("{server}  derive write traffic keys for handshake data", "key expanded (16 octets)", key="s_hs_key")
    after("{server}  derive write traffic keys for handshake data", "iv expanded (12 octets)", key="s_hs_iv")
    # RFC 8448 never prints the client's handshake write keys directly; it says
    # they are "the same as server handshake data read traffic keys", so take
    # them from there instead of falling through to the application-data block.
    after("{server}  derive read traffic keys for handshake data", "key expanded (16 octets)", key="c_hs_key")
    after("{server}  derive read traffic keys for handshake data", "iv expanded (12 octets)", key="c_hs_iv")
    after("{server}  derive write traffic keys for application data", "key expanded (16 octets)", key="s_ap_key")
    after("{server}  derive write traffic keys for application data", "iv expanded (12 octets)", key="s_ap_iv")
    after("{client}  derive write traffic keys for application data", "key expanded (16 octets)", key="c_ap_key")
    after("{client}  derive write traffic keys for application data", "iv expanded (12 octets)", key="c_ap_iv")

    def record(octets, occurrence=0):
        """Records can straddle a page break, where the RFC interleaves the
        running header and footer; skip those lines rather than end the block."""
        needle = f"complete record ({octets} octets)"
        starts = [m.start() for m in re.finditer(re.escape(needle), text)]
        if len(starts) <= occurrence:
            raise SystemExit(f"record {octets} #{occurrence} not found")
        j = text.index(":", starts[occurrence]) + 1
        acc = []
        while len(acc) < octets:
            nl = text.find("\n", j)
            if nl < 0:
                break
            s = text[j:nl].strip()
            j = nl + 1
            if not s or s.startswith("Thomson") or s.startswith("RFC 8448") or "[Page" in s:
                continue
            toks = s.split()
            if not all(HEX.match(t) for t in toks):
                continue
            acc += [int(t, 16) for t in toks]
        if len(acc) < octets:
            raise SystemExit(f"record {octets} #{occurrence}: got {len(acc)} bytes")
        return bytes(acc[:octets]).hex()

    out["rec_server_flight"] = record(679)     # s hs, seq 0
    out["rec_client_finished"] = record(58)    # c hs, seq 0
    out["rec_server_ticket"] = record(227)     # s ap, seq 0
    out["rec_client_app"] = record(72, 0)      # c ap, seq 0
    out["rec_server_app"] = record(72, 1)      # s ap, seq 1  <- the seq>0 case

    # RFC 7748 section 6.1, so the ECDHE is checked too.
    out["x25519"] = {
        "a_priv": "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
        "a_pub": "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
        "b_priv": "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
        "b_pub": "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f",
        "shared": "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742",
    }
    return out


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    json.dump(collect(open(sys.argv[1], encoding="utf8").read()), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
