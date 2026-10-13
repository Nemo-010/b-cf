#!/usr/bin/env bash
# Regenerate every proof cited in RESEARCH.md.
#
#   sh tools/reproduce.sh
#
# Needs: curl, python3, node (20.6+; a static build is enough).
# Steps 1,2,3,3b,3c,5 and the corpus update in step 4 need the Electrosphere.
# Every fetch is written to a temporary file first and only moved over the
# committed proof if it came back as a real 200 with a plausible body, so
# running this offline leaves the checked-in evidence intact and says so.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P="$ROOT/proofs"
mkdir -p "$P"
NODE="${NODE:-node}"

# get <url> <dest> <max-seconds> [min-bytes]
get() {
  url="$1"; dest="$2"; limit="$3"; min="${4:-32}"
  tmp="$dest.tmp.$$"
  code=$(curl -sS --max-time "$limit" -o "$tmp" -w '%{http_code}' "$url" 2>/dev/null || true)
  code=${code:-000}
  size=$(wc -c < "$tmp" 2>/dev/null || echo 0)
  if [ "$code" = "200" ] && [ "$size" -ge "$min" ]; then
    mv "$tmp" "$dest"
    echo "  http=200 bytes=$size -> $(basename "$dest")"
  else
    rm -f "$tmp"
    echo "  FETCH FAILED (http=$code bytes=$size); keeping the committed $(basename "$dest")"
    return 1
  fi
}

echo "== 1. TLS fingerprint seen by an origin, through the current api.rv.pkgforge.dev =="
get "https://api.rv.pkgforge.dev/https://tls.peet.ws/api/all" "$P/01-api-rv-tls.json" 45 200 || true
python3 - "$P/01-api-rv-tls.json" <<'PY' | tee "$P/01-api-rv-tls.txt"
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print("could not parse:", e); raise SystemExit(0)
t = d.get('tls', {}) or {}
h = d.get('http2', {}) or {}
print("ip              =", d.get('ip'))
print("http_version    =", d.get('http_version'))
print("user_agent      =", d.get('user_agent'))
print("ja3             =", t.get('ja3'))
print("ja3_hash        =", t.get('ja3_hash'))
print("ja4             =", t.get('ja4'))
print("peetprint_hash  =", t.get('peetprint_hash'))
print("h2_akamai_hash  =", h.get('akamai_fingerprint_hash'))
sf = h.get('sent_frames') or []
print("h2_settings     =", json.dumps(sf[0].get('settings') if sf else None))
PY

echo
echo "== 2. Headers an origin receives, through the current api.rv.pkgforge.dev =="
get "https://api.rv.pkgforge.dev/https://httpbin.org/headers" "$P/02-api-rv-headers.json" 30 64 || true
python3 -c "
import json,sys
try:
    d=json.load(open('$P/02-api-rv-headers.json'))
except Exception as e:
    print('could not parse:',e); sys.exit(0)
for k,v in sorted(d.get('headers',{}).items()): print(f'{k}: {v}')
" | tee "$P/02-api-rv-headers.txt"

echo
echo "== 3. r.jina.ai TLS fingerprint (what real-browser impersonation looks like) =="
get "https://r.jina.ai/https://tls.peet.ws/api/all" "$P/03-jina-tls.txt" 60 200 || true
python3 - "$P/03-jina-tls.txt" <<'PY'
import json, sys
try:
    txt = open(sys.argv[1]).read()
    d = json.loads(txt[txt.find('{'):])
    t = d.get('tls', {}) or {}
    print("ip           =", d.get('ip'))
    print("user_agent   =", d.get('user_agent'))
    print("ja3_hash     =", t.get('ja3_hash'))
    print("ja4          =", t.get('ja4'))
    print("peetprint    =", t.get('peetprint_hash'))
except Exception as e:
    print("could not parse:", e)
PY

echo
echo "== 3b. Jina Reader on a Cloudflare-protected page (does it solve?) =="
get "https://r.jina.ai/https://nowsecure.nl/" "$P/08-jina-nowsecure.txt" 60 64 || true
head -8 "$P/08-jina-nowsecure.txt"

echo
echo "== 3c. Userland TLS: does a raw-socket program choose its own fingerprint? =="
echo "   (independent proof for RESEARCH.md section 2, Layer 1)"
if out=$(cd "$ROOT" && "$NODE" tools/tls13-client.mjs); then
  printf '%s\n' "$out" | tee "$P/09-userland-tls-fingerprints.txt"
else
  echo "  FAILED (network/rate limit); keeping the committed 09-userland-tls-fingerprints.txt"
fi

echo
echo "== 4. Raw Chrome ClientHello: refresh the b-ids corpus, then recompute JA4 =="
CH="$ROOT/evidence/bids/routes_client-hello-hex_chrome_stable_latest_linux64.txt"
CORPUS="$ROOT/evidence/bids/corpus_v1_latest.json"
if get "https://raw.githubusercontent.com/Azathothas/b-ids/data/corpus/v1/latest.json" "$CORPUS" 30 200 \
   && get "https://raw.githubusercontent.com/Azathothas/b-ids/data/routes/client-hello-hex/chrome/stable/latest/linux64.txt" "$CH" 30 200; then
  :
else
  echo "  corpus refresh skipped; computing from the committed capture"
fi
python3 "$ROOT/tools/ja4.py" "$CH" | tee "$P/04-bids-ja4.txt"

echo
echo "== 5. Profiles still match the b-ids corpus =="
if out=$(cd "$ROOT" && "$NODE" tools/bids-profile.mjs); then
  printf '%s\n' "$out" | tail -1 | tee "$P/05-bids-profiles.txt"
else
  echo "  corpus check needs the Electrosphere; keeping the committed 05-bids-profiles.txt"
fi

echo
echo "== 6. Reference implementation: unit tests, then the same tests with the network poisoned =="
# TAP prints a diagnostics block per subtest; the proof keeps the plan and the
# totals, which are the part that has to be read, and is stable across runs.
SUMMARY='^(1\.\.[0-9]+|# (tests|suites|pass|fail|cancelled|skipped|todo))'
{
  echo "-- cd reference && node --test test/*.test.mjs --"
  (cd "$ROOT/reference" && "$NODE" --test test/*.test.mjs 2>&1) | grep -E "$SUMMARY"
  echo
  echo "-- the same suite with every socket entry point poisoned (tools/no-network.mjs) --"
  (cd "$ROOT/reference" && "$NODE" --import "$ROOT/tools/no-network.mjs" --test test/*.test.mjs 2>&1) | grep -E "$SUMMARY"
} | tee "$P/06-tests.txt"

if ! grep -q '^# fail 0$' "$P/06-tests.txt" || [ "$(grep -c '^# fail 0$' "$P/06-tests.txt")" -ne 2 ]; then
  echo "  BOTH RUNS MUST REPORT 'fail 0'; one did not. Treat the proofs as invalid."
fi

echo
echo "== 7. Cost model =="
python3 "$ROOT/tools/cost-model.py" | tee "$P/07-cost.txt"

echo
echo "proofs written to $P"
