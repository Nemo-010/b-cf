# `api.rv.pkgforge.dev` v2 — evidence-backed research

**Subject.** Replace the single-hop reverse proxy at `api.rv.pkgforge.dev` with a
generation that can reach pages the current one cannot, that keeps running as a
Cloudflare Worker with no infrastructure we operate, and that answers the
question the brief actually turns on: *can it pass as a 100% real browser for
CAPTCHAs, and what does each alternative cost?*

**Prepared for** Ajam. **Dated** 2026-10-13. **Tree** this repository (§11).

---

## 0. Verdict, up front

1. **"100% real browser" is still out of reach on Cloudflare Workers, but not for
the reason this document first gave.** The ClientHello is *not* owned by the
runtime: `cloudflare:sockets` `connect()` returns a raw byte stream, so a Worker
can run its own TLS handshake and present any fingerprint it likes (§2, Layer 1).
What remains runtime-owned is the **egress IP/ASN** (no rotation, Cloudflare
ranges) and the **signed bot-identity headers on every Browser Run request**,
which Cloudflare documents as a feature. Those two are walls. TLS is not, and
this revision exists because the first version of it said otherwise.

2. **A very good Worker proxy is still possible, and cheap.** Rendering is not
   the expensive part: **1,000 fully-rendered pages cost $0.05** on Browser Run,
   and the first **18,000 pages/month are free** inside the Workers Paid
   allowance. The current proxy already answers in **70–330 ms** and the upgrade
   keeps that path as tier 0.

3. **CAPTCHA "solvers" are worth shipping only for two families**, and both are
solved with Workers AI at ~**$0.10 per 1,000 solves**: distorted-text images
(vision model) and the accessibility audio challenge (Whisper). Everything else
— Turnstile interactive, Cloudflare managed challenge, reCAPTCHA v3 score,
DataDome, PerimeterX — has no shipped serverless solve. The usual obstacle, "a
Chrome TLS fingerprint", is now available (§2, Layer 1); what is still missing
for Turnstile is a browser-grade JS environment to run the obfuscated challenge
VM, not the handshake.

4. **If you need the hard 5–20% of pages, buy the browser, not the proxy.**
   Browser Use, Browserbase and friends rent a *real* Chrome on a residential
   IP. The cheapest of them, Browser Use, is **$0.02/browser-hour + $5/GB of
   residential traffic** — browser time is noise next to **bandwidth**, which is
   97% of the bill at 1.5 MB/page.

5. **DIY parity at $0–5/month reaches everything except the egress IP.** The
   feature matrix in §9.4 shows the fetch, render, markdown, PDF, screenshot,
   crawl, cache and solver features all landing at zero marginal cost on
   Cloudflare — and, after the Layer 1 correction, so does a browser-shaped
   handshake. The rows that stay red are "leaves from a non-datacenter IP" and
   "is not cryptographically self-identified as a bot", and no amount of Worker
   engineering moves either.

Greetings from Port Edwards. Neucom Info would build this the same way: keep the
cheap path cheap, be honest about which layer you do not own, and — this time —
check before writing a layer off.

---

## 1. Method, and what was and was not run

Measured:

| thing | how |
| --- | --- |
| TLS/HTTP2 fingerprint of the live proxy | `tls.peet.ws/api/all` fetched *through* `api.rv.pkgforge.dev` → `proofs/01` |
| Headers an origin receives from the live proxy | `httpbin.org/headers` through the proxy → `proofs/02` |
| TLS fingerprint of a real Chrome, from raw bytes | b-ids `client-hello-hex` route + `tools/ja4.py` → `proofs/04` |
| TLS fingerprint of a browser-impersonating fetch | `r.jina.ai/https://tls.peet.ws/api/all` → `proofs/03` |
| Latency of the live proxy | 10 timed requests, §9.1 |
| Source-level behaviour of Jina Reader, browser-use, b-ids, the current worker | shallow clones, cited by `file:line` |
| Cloudflare product behaviour | first-party docs fetched as markdown on 2026-10-13 |
| Solver cost | Workers AI published neuron rates × measured token/audio volumes, `tools/cost-model.py` |
| Whether a raw-socket program can choose its TLS fingerprint | `tools/tls13-client.mjs`, two profiles, against `tls.peet.ws` → `proofs/09` |
| Whether that TLS client is correct | RFC 8448 §3 key-schedule and record vectors + RFC 7748 §6.1, as unit tests → `proofs/06` |
| Prior art for userland TLS on Workers | shallow clones of `latentharbor/tunnelfetch`, `EithonX/socksflare`, cited by `file:line` |
| Reference implementation | 36 unit tests, run locally → `proofs/06` |

Not run, and therefore not claimed:

- **No Cloudflare account was used.** Nothing was deployed. Every statement about
  Browser Run's *runtime* behaviour comes from Cloudflare's own documentation and
  from a first-party marketing page, not from our own observation. A stealth
  pass-rate for Browser Run was therefore **not measured**; §5 gives the
  structural ceiling instead of a fake number.
- **No userland TLS was run inside a Worker.** The handshake proof is in Node over
  a raw socket, which is the same byte-stream shape `connect()` exposes; the
  CPU cost of the same stack on workerd is not measured here, only quoted from
  `tunnelfetch`'s own edge measurements.
- `api.rv.pkgforge.dev` is a live third-party Worker. It was probed read-only.
- Jina's per-token price table is client-rendered and does not appear in the
  served HTML; the free tier and rate limits are cited, the token price is not.

Reproduce everything with `sh tools/reproduce.sh` (§11).

---

## 2. The detection stack, layer by layer

Seven layers decide whether a request reads as a browser. A Cloudflare Worker
writes three of them itself, partly influences a fourth, and can replace a fifth
by renting a real browser.

| # | layer | what decides it | Worker control | evidence |
| --- | --- | --- | --- | --- |
| 1 | TCP + TLS ClientHello (JA3/JA4/PeetPrint) | **our code**, via `connect()` + userland TLS | full, at a CPU cost | `proofs/09` |
| 2 | HTTP/2 framing + SETTINGS (Akamai hash) | our code over `connect()`; workerd's stack over `fetch()` | full over `connect()`, none over `fetch()` | §2 note below |
| 3 | HTTP header *values* | our code | full | b-ids corpus |
| 4 | HTTP header *order* | runtime serialisation | partial / unverified | §12 |
| 5 | Egress IP, ASN, rDNS | Cloudflare's network | **none** | CF FAQ |
| 6 | Declared bot identity (crypto signature, bot ID) | Cloudflare's edge, on purpose | **none** | CF docs |
| 7 | Browser-side JS/WebGL/canvas fingerprint | the browser process | via Browser Run, partly | §3.1 |

Note that layers 1 and 2 move together. Presenting a Chrome ClientHello and then
speaking workerd's HTTP/2 makes the pair *more* suspicious than the honest default
would be, so userland TLS is only worth doing as part of a userland HTTP/2 client
— which is what the prior art in Layer 1 below actually ships.

### Layer 1 — TLS. `fetch()` is closed; `connect()` is not

The first version of this document said layer 1 was closed, full stop. That was
wrong, and the correction is worth stating precisely because it changes the whole
architecture.

`fetch()` has no TLS surface — no cipher list, no extension order, greasing, ALPN
or key-share control — and `node:tls`/`node:net` just wrap the same runtime, so
they inherit the same limits. But `cloudflare:sockets` `connect()` also accepts
`secureTransport: "off"`, and that returns a **raw duplex byte stream**. The
runtime is no longer a TLS endpoint; it is a pipe. Everything a TLS client does
above the socket is therefore ours to implement, and the ClientHello is only a
byte string we choose to send.

| transport | who writes the ClientHello | fingerprint is |
| --- | --- | --- |
| `fetch()` | workerd | fixed, not a browser, and not ours |
| `connect({ secureTransport: 'off' })` + userland TLS | **us** | whatever we encode |
| `connect()` → `startTls()` | workerd, and it fails closed for tunnels | not ours |
| `node:net` / `node:tls` | workerd, on top of `connect()` | not ours |

The `startTls()` row is a real trap rather than a shortcut.
`startTls()` verifies the peer certificate against the hostname given to
`connect()`, which inside a tunnel is the *proxy*, not the origin.
`expectedServerHostname` looks like the fix and is not — workerd's own source
calls it "not currently supported", logs every use and carries an autogate to
reject it; and `tunnelfetch/README.md:42-70` measured the end state on the edge:
a CONNECT tunnel followed by `startTls({ expectedServerHostname: origin })` fails
with `TLS Handshake Failed`. Nor can the certificate be re-checked afterwards,
because `getPeerCertificate()` throws `not implemented` and
`rejectUnauthorized: false` throws. `connect()` + userland TLS exists precisely
because it is the only path left.

**The default is what the current proxy already does**, and it is the worst of
both worlds. Fetched through `api.rv.pkgforge.dev` (`proofs/01-api-rv-tls.txt`):

```
ja4             = t13d1312h2_a44d0ee8b3cc_e381dae6da6b
ja3_hash        = 67560f98d68783bd640246df3052c151
peetprint_hash  = 86a3486140e2241fdfbdbe981958219e
h2_settings     = ["ENABLE_PUSH = 0", "MAX_CONCURRENT_STREAMS = 1",
                   "INITIAL_WINDOW_SIZE = 8388608", "MAX_FRAME_SIZE = 65536"]
```

Against a real Chrome 155 parsed from the raw ClientHello in b-ids
(`proofs/04-bids-ja4.txt`):

```
ja4        = t13i1516h2_8daaf6152771_6ff14566cf4a
ciphers    = 002f,0035,009c,009d,1301,1302,1303,c013,c014,c02b,c02c,c02f,c030,cca8,cca9
extensions = 0005,000a,000b,000d,0010,0012,0017,001b,0023,002b,002d,0033,44cd,ca34,fe0d,ff01
```

So `worker.js:15` announces a Safari 18.5 / macOS User-Agent while `worker.js:64`
does a plain runtime `fetch()` — a browser User-Agent on a handshake with 13
cipher suites, no GREASE and Cloudflare's own HTTP/2 SETTINGS. That mismatch is
the strongest single bot signal in the request as it stands today, and it is
free to remove: send a UA that matches the transport, or construct both.

For contrast, `r.jina.ai` presents `Chrome/155.0.0.0` with
`ja4 = t13d1515h2_8daaf6152771_d4f5850a23ca` (`proofs/03`), cipher hash
`8daaf6152771` — the same browser cipher set as the b-ids capture. Jina gets
there by bundling `@nomagick/node-libcurl-impersonate` and hard-coding the
fingerprint (`jina-reader/src/services/curl.ts:5`, `:68-73`):

```ts
// jina-reader/src/services/curl.ts:68-73, abbreviated
impersonateCfg = getChromeConfig({
  version: this.chromeVersion,
  fingerprint: {
    ja3:  '772,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,23-0-45-…',
    ja4:  't13d1514h2_002f,0035,009c,009d,1301,1302,1303,c013,c014,c02b,c02c,c02f,c030,cca8,cca9_…',
    akami:'1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p'
  }
});
```

Jina pays for that with a bundled native curl. A Worker pays for the same thing
with CPU, in userland, and that route does exist:

**This is not a proposal. It is shipping code.** Two independent projects do it:

- **`latentharbor/tunnelfetch`** (`README.md:54-70`, and
  `src/tls/{handshake,keyschedule,record,extensions,grease,hybrid,tickets}.js`) is
  TLS 1.2 and 1.3 written in userland ESM, with zero dependencies, no build step
  and no `node:` imports in `src/`. It carries a Chrome profile
  (`src/profiles.js:87-106`: Chrome's cipher list, `alpn: ['h2', 'http/1.1']`,
  `grease: true`, `extensionOrder: SHUFFLE_EXTENSIONS`) that
  `src/profile/chrome.js:33` says was "captured off the wire from Chrome 150",
  plus a full HTTP/2 stack with HPACK and Huffman (`src/http2/`). The author
  reports it verified end to end on the Cloudflare edge through five proxies:
  TLS 1.3, `TLS_AES_128_GCM_SHA256`, X25519, ALPN negotiating `h2`, HTTP/2,
  gzip, chains validated against 121 bundled CCADB roots, **with no
  compatibility flags** (`README.md:79-82`, `:77`). It also bundles ML-KEM-768
  and ChaCha20-Poly1305 compiled to WASM (`src/profile/vendor/`) so the Chrome
  identity can include `X25519MLKEM768`.
- **`EithonX/socksflare`** (`README.md:5-6`) is the literal version of the
  suggestion that started this revision: **rustls compiled to WebAssembly**
  (`rust-tls-wasm/pkg/rust_tls_wasm_bg.wasm`), used the same way, for the same
  reason (`README.md:21-24`, "Why not `startTls()`?"). Worth noting its own
  warning: rustls's ClientHello "may have a different fingerprint than standard
  browsers" — having your own handshake is a prerequisite for looking like
  Chrome, not a guarantee of it. The fingerprint has to be constructed.

I verified the mechanism myself rather than taking the above on trust. The proof
is small enough to read: `tools/tls13-client.mjs` is a minimal TLS 1.3 client —
X25519, one AEAD, no certificate verification — whose ClientHello is a function
of a **profile object** (cipher list, groups, signature algorithms, extension
set, order, GREASE on/off). Run twice against `tls.peet.ws`, which reflects the
handshake it received (`proofs/09-userland-tls-fingerprints.txt`):

```
chrome-like  ja4 = t13d1513h1_8daaf6152771_479629d6bd83
minimal      ja4 = t13d37h1_55b375c5d22e_ceda16c4aa8b
```

The `1513` and `37` are the CIPHER/EXTENSION counts JA4 reports after discarding
GREASE (15 ciphers and 13 extensions for the first; 3 and 7 for the second).
`tls.peet.ws` counts the raw lists instead, so its side of the comparison reads
16 and 15.

The same binary produced both. The cipher half of the Chrome hash,
`8daaf6152771`, is **byte-identical to the real-Chrome capture in
`proofs/04-bids-ja4.txt`** (`t13i1516h2_8daaf6152771_6ff14566cf4a`) and to
`r.jina.ai`'s (`t13d1515h2_8daaf6152771_d4f5850a23ca`). That is not a
coincidence to be waved at: it means a hand-built hello can reproduce the cipher
component of a real browser's JA4 exactly. The parts that still differ are named
in §12 — the extension set is partial, ALPN is `h1` here where Chrome sends `h2`,
and the `d`/`i` flag reflects whether SNI is present.

The client is checked against published vectors so this does not rest on "it
connected once". `tools/rfc8448-extract.py` pulls the key schedule and record
vectors out of RFC 8448 §3, and `reference/test/tls13-kat.test.mjs` verifies
X25519 against RFC 7748 §6.1, the early/handshake/master secret chain, both
handshake and both application traffic secrets, every traffic key and IV, and
the record layer by decrypting the RFC's own records — **including a record at
sequence number 1**, which is where the interesting bug was. Both bugs this
exercise found are worth recording because they are the kind that produce a
"handshake completed" log with a wrong fingerprint:

- HKDF-Expand without the counter byte. Every secret wrong, and the RFC 8448
  vectors caught it immediately.
- `seq >> (8 * i)` in the AEAD nonce. JavaScript masks shift counts to five
  bits, so `i === 4` becomes `>> 0` and XORs a *second* IV byte. The result is
  that only the first record under any key decrypts — which looks exactly like
  "the server sent an unexpected alert".

So layer 1 is closed for `fetch()` and open for `connect()`. What is left is the
cost, and it is not nothing:

- **One full handshake per connection, and a connection per request.** A Worker
  has no request-scoped connection pool, so pooling only helps within one
  invocation. `tunnelfetch/README.md:113-115` measures the difference on the
  edge: **~10 ms of CPU for a fresh handshake against 0.9 ms warm**. At
  `tunnelfetch/README.md:943-955` that lands as $5.00/month for 10M pooled 16 KB
  requests versus $6.20/month for a new connection each — and $24.80 versus
  $31.40 for 4 MB pages. A hand-rolled stack will be in the same range or worse.
- **HTTP/2 costs *more* CPU than HTTP/1.1**, not less
  (`tunnelfetch/README.md:421`), because HPACK is compression work on a
  CPU-metered platform. It is worth doing to reach sites that treat a missing
  `h2` as a signal, not to save money.
- **Budget and shape.** Workers Paid gives 30M CPU-ms/month, Workers caps an
  invocation at six simultaneous open connections, and an isolate has a 128 MB
  ceiling (`tunnelfetch/README.md:628`). A ~10 ms handshake plus HPACK plus a
  body in the hundreds of KB is the right order of magnitude for one page, which
  is fine — but it means the fast path and the stealth path have genuinely
  different price tags, which is why §5 keeps them in separate tiers.

**One thing the old version got half right.** It observed that across three runs
`r.jina.ai`'s **JA3 hash changed every time** (`23f544c0…`, `d0bb6f1b…`,
`e360dd2d…`) while its **JA4 stayed identical**
(`t13d1515h2_8daaf6152771_d4f5850a23ca`), and concluded "Chrome's per-connection
extension shuffle; therefore use JA4." The shuffle reading is correct and
`tunnelfetch/src/profiles.js:104` records the same measurement ("two hellos,
identical extension set, entirely different orders. Chromium shuffles"). The
error was the conclusion drawn from it: a *shuffling* ClientHello is obviously
not a *fixed* one, so that observation should have been the first hint that
somebody upstream was constructing these bytes by hand.


### Layer 2 — HTTP/2

Over `fetch()`, this is Cloudflare's stack and nothing in a Worker changes it:
`MAX_CONCURRENT_STREAMS = 1` and `INITIAL_WINDOW_SIZE = 8388608`, Akamai hash
`175a6d4585f5a5c52b0f6fcca2977cd0` (`proofs/01`).

Over `connect()` it is ours, because HTTP/2 needs no runtime support — it is a
framing and a HPACK table over the same byte stream TLS runs on. `tunnelfetch`
ships exactly that (`src/http2/{connection,frames,hpack,huffman}.js`), and its
Chrome profile carries the SETTINGS and the pseudo-header order alongside the
ClientHello (`src/profiles.js:87-106`), so the two layers move as one identity
rather than one good fingerprint sitting on a foreign transport.

The cost is real and runs the wrong way: HPACK is compression work, so HTTP/2
costs *more* CPU than HTTP/1.1 on this platform
(`tunnelfetch/README.md:421`). Add it to reach origins that reject a client
which cannot speak `h2`, not to save time.

### Layers 3–4 — header values and order

Values are ours to set, and b-ids hands us the exact ones for a real build. The
reference implementation ships two measured profiles, verified against upstream
by `tools/bids-profile.mjs`:

```
chrome-155-linux
  user-agent      Mozilla/5.0 (X11; Linux x86_64) ... Chrome/155.0.0.0 Safari/537.36
  sec-ch-ua       "Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"
  accept-language en-US,en;q=0.9
  order           sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform,
                  upgrade-insecure-requests, user-agent, accept, sec-fetch-site,
                  sec-fetch-mode, sec-fetch-user, sec-fetch-dest,
                  accept-encoding, accept-language, priority
```

Order is *partially* controllable and I could not verify it end to end; see
§12. Treat it as best-effort, not as a fingerprint.

### Layers 5–6 — the walls Cloudflare builds on purpose

From the Browser Run FAQ, verbatim:

> **Will Browser Run be detected by Bot Management?** Yes, Browser Run requests
> are always identified as bot traffic by Cloudflare.

> **Does Browser Run rotate IP addresses for outbound requests?** No. […] All
> rendering traffic comes from Cloudflare IP ranges…

And the non-configurable headers on **every** Browser Run request
(`browser-run/reference/automatic-request-headers`):

| header | meaning |
| --- | --- |
| `cf-brapi-request-id` / `cf-brapi-devtools` | which Browser Run method made the call |
| `cf-biso-devtools` | "the request originated from Cloudflare's rendering infrastructure" |
| `Signature-agent`, `Signature`, `Signature-input` | Web Bot Auth: a **cryptographic** declaration that this is a bot |

The bot-detection IDs are public: `119853733` for Quick Actions / Puppeteer /
Playwright / CDP, `128292352` for `/crawl`. A destination can allowlist or block
us by ID. The product page sells this as *"Well-behaved Bot Mode — identifies
itself as a bot using cryptographic signatures"*.

That is not a bug we can route around. It is Cloudflare deciding, at the product
level, that Browser Run will never be indistinguishable from a human browser. Any
plan whose success criterion is "pass captchas as a 100% real browser" fails here
regardless of what else we build.

---

## 3. What each product actually does

### 3.1 Cloudflare Browser Run

**Access model.** A Workers binding (`env.BROWSER`) with no API token, or REST
with `Browser Run - Edit`. Quick Actions can be called in-worker as
`env.BROWSER.quickAction("markdown", { url })`, no network hop, since compatibility
date `2026-03-24`.

**Endpoints.** `/content`, `/markdown`, `/screenshot`, `/pdf`, `/snapshot`
(multi-format in one call), `/scrape`, `/links`, `/json` (Workers AI extraction),
`/accessibilityTree`, `/crawl` (async, R2, 14-day retention). Sessions via
Puppeteer, Playwright or raw CDP. **Kitesurf**, a stateless non-Chromium engine,
is in beta and free, and accepts `browser=kitesurf`.

**Honest limits.** The Kitesurf page states its own failure mode plainly:

> Kitesurf is not yet the right option if you need to […] negotiate a
> bot-challenge handshake with real TLS fingerprints.

That is Cloudflare admitting the thing this brief is about is out of scope for
the cheap engine, and handled by the flagged one for the expensive engine.

**Rates** (`browser-run/pricing`, `browser-run/limits`):

| | Workers Free | Workers Paid |
| --- | --- | --- |
| browser hours | 10 min/day | 10 h/mo, then **$0.09/h** |
| concurrent browsers (sessions) | 3 | 10 incl., then **$2.00** each (monthly average) |
| browser timeout | 60 s idle, up to 10 min with `keep_alive` | same |
| Quick Actions rate | 1 req / 10 s | 30 req/s |

Failed `waitForTimeout` calls are not billed. Browser time is what Quick Actions
cost; Sessions cost browser time **plus** concurrency.

### 3.2 Jina Reader (`r.jina.ai`)

**What it is.** A URL → LLM-friendly-text service, and the most instructive
competitor because its source is public. Engine selection is explicit
(`jina-reader/src/dto/crawler-options.ts:22-27`):

```ts
export enum ENGINE_TYPE { AUTO='auto', BROWSER='browser', CURL='curl', CF_BROWSER_RENDERING='cf-browser-rendering' }
```

and it *defaults to `curl` for anonymous HTML requests* (`src/api/crawler.ts:333`),
escalating to a real browser only when needed. Its own docs describe the same
ladder: `X-Engine: direct` (plain fetch), default (headless browser),
`cf-browser-rendering` (Cloudflare-backed, experimental).

**Its stack, from source:**

| piece | file | what it buys |
| --- | --- | --- |
| TLS impersonation | `src/services/curl.ts:5,68-73,136` | Chrome JA3/JA4/Akamai |
| residential/ISP proxies | `src/services/proxy-provider/index.ts:29-34` (ThorData) | non-datacenter IP |
| headless Chrome | `src/services/puppeteer.ts` | JS rendering |
| patch set | `src/services/minimal-stealth.js:573-601` | WebGL vendor/renderer, `navigator.webdriver` |
| Cloudflare renderer | `src/services/cf-browser-rendering.ts:33` | a third engine |

So Cloudflare itself concedes the comparison: Jina uses Browser Run as one of
its engines, and adds the two layers Browser Run lacks (TLS impersonation and
proxy IPs) on its own boxes.

**Pricing:** free at **20 RPM** with no key; **500 RPM** with a free key, which
comes with 10M free tokens; paid/premium tiers raise RPM to 5,000, token-metered.
Jina states the honest ceiling itself: *"Upgrading from a free tier to a paid API
key does not grant access to additional websites or bypass any site
restrictions."*

**And it does not solve challenges.** Fetching the community's standard
Cloudflare-protection test page through it (`proofs/08-jina-nowsecure.txt`):

```
Warning: This page maybe requiring CAPTCHA, please make sure you are authorized to access this page.
```

It detected the gate and returned the placeholder. No solve. Raw output in
`proofs/08-jina-nowsecure.txt`.

### 3.3 browser-use

**Open source vs. cloud.** The repo (`browser-use/browser-use`, v0.13.11,
`pyproject.toml`) is an *agent framework* — it drives a browser you supply. The
stealth and the proxies live in the paid cloud, so cloning the repo buys the
automation loop, not the evasion.

**Rates** (`browser-use.com/pricing.md`, machine-readable, "last verified
against the live V4 contract on September 3, 2026"):

| item | price |
| --- | --- |
| cloud browser session | **$0.02 / browser-hour** (1-minute minimum, rounded up) |
| managed residential proxy | **$5.00 / GB** |
| direct connection or BYO proxy | **$0.20 / GB** |
| model markup | model cost **+20%** (BYOK: 0.2× orchestration fee) |
| free tier | one-time $1 credit, 10 concurrent sessions |
| concurrency | 10 → 1,000 by lifetime spend ($0 → $25,000) |

**Its own numbers for stealth:** 81% on 71 high-security sites, 84.8% on a
296-task suite, "first among the evaluated providers", with the caveat that
*"Stealth changes as websites and antibot systems evolve, so treat these as
measured results rather than a guarantee for every site."* The best-in-class
commercial product in this space advertises **81%, not 100%**. That is the
number to hold against the brief.

Its site lists **CAPTCHA solving** as a product solution — i.e. it is a paid
feature of a residential-IP browser, not something a Worker replicates.

### 3.4 Azathothas/b-ids

Not a product; the measurement source. A provenance-carrying corpus of what real
browser builds put on the wire: raw `ClientHello` bytes, HTTP/2 settings, header
order, UAs. Its invariants (`AGENTS.md`):

> A browser fingerprint is measured from a real browser at a named build and
> instant. Fixtures, inferred names, and inherited claims are never published as
> measurements.

> Preserve raw capture bytes beside normalized profiles.

This matters for us three ways: (a) it is where the profiles come from, (b) it is
why we can *prove* what a real ClientHello looks like rather than assert it, and
(c) its `routes.json` teaches a cautionary lesson — a naive query over the index
returned a **HeadlessChrome/151** UA for the `latest` Chrome cell (a stale
capture from the harness itself). The generator in `tools/bids-profile.mjs` now
pins the `latest` route directly and fails on drift, precisely because inheriting
a stale measurement is the failure mode this corpus exists to prevent.

---

## 4. So what would "100% real browser" require?

| requirement | met by a Worker? | why not |
| --- | --- | --- |
| Chrome-order TLS ClientHello with GREASE | **yes**, at a CPU cost | `connect()` + userland TLS (§2) |
| Browser HTTP/2 SETTINGS | **yes**, same route | userland HTTP/2 (§2) |
| Exact header set, values, order | mostly | order unverified (§12) |
| Residential / ISP egress IP | **no** | Cloudflare ranges only |
| No self-identifying bot headers | **no** on Browser Run | non-overridable, signed |
| Real Chromium JS/WebGL/canvas | yes | Browser Run |
| Answers a visual/audio challenge | **sometimes** | §6 |
| Low request rate, plausible navigation order | yes | our code |

Three of eight are impossible from a Worker; two more are bought rather than
built. But the two that were previously impossible *by construction* — the
handshake and the framing — are now just expensive, and the distinction matters:
"the runtime won't let us" and "we can, for N ms of CPU" lead to different
architectures. What is genuinely unmovable is the **egress IP**: every request
still leaves from a Cloudflare ASN, and no amount of handshake engineering
changes that. The engineering conclusion is therefore narrower than before, but
still not "make the Worker stealthier": the Worker can now be made to *look*
right cheaply, and the residual evasion problem is an IP problem, which is
purchasable.

---

## 5. What is achievable: a tier ladder

Each tier is additive, and each answers a different class of site. Pass-rate
claims are deliberately absent — the remaining ceiling is set by layers 5 and 6,
and we did not deploy, so any percentage would be invented. What *is* claimable
is the mechanical reach of each tier.

| tier | engine | reaches | cost /1000 pages | notes |
| --- | --- | --- | --- | --- |
| **T0** | `fetch()` + measured headers | static pages, APIs, most docs | **$0** | current proxy's path, kept fast |
| **T0s** | `connect()` + userland TLS/HTTP2 | sites that fingerprint the handshake but not the IP | **$0 + CPU** | best fingerprint available to us; §2, Layer 1 |
| **T1** | Browser Run Quick Action | SPAs, JS-rendered, cookie/header auth | **$0.05** | real Chromium, but flagged as a bot |
| **T2** | Browser Run session + page hooks | login flows, multi-step, needs state | **$0.05 + concurrency** | billed for concurrent browsers |
| **T3** | T2 + Workers AI solvers | image captchas, audio challenges | **+$0.10–0.12 /1000 solves** | §6 |
| **T4** | T2 + `human:handoff` | Turnstile interactive, hard challenges | operator time | Live View exists; the reference emits an explicit "unsolved" signal instead of faking success |
| **T5** | an external residential browser (Browser Use et al.) | bot-managed sites | **$7.34 /1000 @1.5 MB** | the only tier that moves layer 5 |

The design rule that falls out: **T0 is the default, T0s is a flag, T1 is the
fallback, T3 is worth enabling, T5 is an explicit opt-in escape hatch.** Tiers
0–3 are what the reference implementation ships; T0s ships as an unpopulated
seam (§7, §8) because a correct TLS stack is not something to write into a
research reference and pretend is audited.

---

## 6. Solvers: what is fast, serverless, and actually works

Definition used here: a *solver* answers something the page asked, using
computation that fits in a Worker. A solver is not evasion — the browser still
has to reach the gate.

| challenge | serverless solve? | how | cost /1000 | evidence |
| --- | --- | --- | --- | --- |
| distorted-text image | **yes** | Workers AI vision model → characters | **$0.12** | `solvers/ocr.js`; moondream3.1 at 27,273 neurons/M in-tokens |
| arithmetic image ("4 + 7") | **yes** | same, prompt-constrained | **$0.12** | same |
| reCAPTCHA v2 **audio** | **yes** | Whisper on the audio clip, then type it in | **$0.10** | `solvers/audio.js`; Whisper 46.63 neurons/audio-min |
| hCaptcha **audio** | **yes** | same | **$0.10** | same |
| simple image grid (3×3 "pick the buses") | *no* | needs a purpose-built classifier | — | not shipped on purpose |
| Turnstile **non-interactive** | *no solve needed* | the widget self-issues if the page's own JS passes its checks | browser time only | Turnstile docs: PoW + proof-of-space + API probing, no visible answer |
| Turnstile **interactive / managed** | **no** | — | — | see below |
| Cloudflare "Just a moment" | **no** | cf_clearance is issued by the same gate | — | — |
| reCAPTCHA v3 / Enterprise | **no** | score-based, no challenge to answer | — | — |
| DataDome / PerimeterX / Imperva / AWS WAF | **no** | behavioural + fingerprint scoring | — | no challenge to answer |

### Why there is no Worker-side Turnstile solve

Turnstile's flow is: load `challenges.cloudflare.com/turnstile/v0/api.js`, receive
a challenge with a proof-of-work, a ray, and a metadata blob, answer the PoW,
POST the encrypted payload to `/pat/`, receive a token or `cf_clearance`. The
public attempt at a request-only implementation is
`munew/cloudflare-turnstile-solver` (194★, Rust). Its own README leads with:

> This is out-of-date and absolutely not working. I won't provide any help in
> making this project work…

and its dependency list explains why it is hard: it builds on **`rquest` with
`Emulation::Chrome136`** (`src/solver/task_client.rs:10-12`) plus a decompiler
for Cloudflare's obfuscated VM (`src/decompiler/`, `src/disassembler/`). Two
things a Worker does not have — except that after the Layer 1 correction it does
have the first one. `rquest`'s Chrome emulation is a ClientHello and an HTTP/2
preface, both of which are reproducible in userland (§2), and the Chrome profile
in `tunnelfetch` is the same class of artifact. The blocker that remains is the
second: a JavaScript environment good enough to execute Cloudflare's obfuscated
challenge VM, at a size and CPU cost that still fits a Worker. That is a real
project, not a shim, and it is why nothing here claims a request-only Turnstile
solve.

Every *working* Turnstile solver in the wild (`Theyka/Turnstile-Solver` —
`requirements.txt`: `patchright` + `camoufox[geoip]`; `Sophomoresty/turnstile-bypass`;
`D3-vin/Turnstile-Solver-NEW`) instead drives a patched, anti-detect real browser
on a server — the thing the brief said not to run.

So the reference implementation does the honest thing: it **detects** Turnstile,
**reads** the widget parameters, **waits** for the widget to self-issue inside
the Browser Run session, and if it does not, reports `human:handoff` as
**unsolved**. It never reports a success it did not get, because a proxy that
silently returns a challenge page as if it were content is worse than one that
says "I could not".

### Cost sanity check

A single audio solve costs $0.0001. The browser session that reaches the widget
costs ~$0.00005. **The solver is not the expensive part and never will be.**
Optimising solver cost is working on the wrong axis; the axes are the number of
browser-hours and, if you move to T5, the bytes.

---

## 7. Reference architecture

```
                    ┌──────────────────────────────────────────────┐
  client ──▶ api.rv.pkgforge.dev  (single Worker, one route)       │
                    └───────────────┬──────────────────────────────┘
                                    │ parse target, pick engine
                    ┌───────────────▼───────────────┐
                    │ cache (Cache API, free)       │──▶ hit: return
                    └───────────────┬───────────────┘
                                    │ miss
                    ┌───────────────▼───────────────┐
                    │ T0  fetch() + measured headers │──▶ clean: return
                    └───────────────┬───────────────┘
                                    │ caller asked for it (?engine=tls)
                    ┌───────────────▼───────────────┐
                    │ T0s userland TLS/HTTP2 over    │
                    │     connect() → env.TLS_TRANSPORT
                    │     browser ClientHello        │──▶ return (never auto)
                    └───────────────┬───────────────┘
                                    │ detect.classify() says gate / SPA shell
                    ┌───────────────▼───────────────┐
                    │ T1  env.BROWSER.quickAction()  │──▶ clean: return + cache
                    └───────────────┬───────────────┘
                                    │ still gated
                    ┌───────────────▼───────────────┐
                    │ T2  session (Puppeteer/CDP)    │
                    │ T3  + solve: ocr / audio       │──▶ return + report solver results
                    │ T4  + human:handoff            │──▶ return + honest unsolved flag
                    └────────────────────────────────┘
```

**URL contract, unchanged from v1** so existing callers keep working:

```
https://api.rv.pkgforge.dev/https://host/path?query
https://api.rv.pkgforge.dev/<host>?query                 # bare host gets https://
```

**Engine selection** (first match):
`?engine=fetch|tls|render|markdown|session|auto`, `X-Rv-Engine` header, default
`auto`. `X-Rv-No-Escalate: 1` pins T0. `tls` is the only engine `auto` will never
pick, because it changes the cost model: it needs `env.TLS_TRANSPORT` and pays a
handshake of CPU per request (§2, Layer 1). Asking for it without a transport is
an error, not a silent downgrade to the transport the caller was avoiding.

**Escalation is conservative.** T0's body is classified before it is returned.
Only a *strong* marker (or two weak ones) escalates; a page that merely embeds a
Turnstile widget inside real content is treated as content, not as a gate. The
classifier is a pure function with 8 unit tests.

**Response headers** make the path auditable:

| header | meaning |
| --- | --- |
| `X-Rv-Engine` | `fetch` / `tls` / `browser-run:content` / `browser-run:session` |
| `X-Rv-Ms` | wall time |
| `X-Rv-Challenge` | `none` / `cloudflare-managed` / `turnstile` / … |
| `X-Rv-Profile` | header profile used |
| `X-Rv-Cache` | `hit` / `miss` |

**Cost controls.** GET-only Cache API caching keyed on the normalised URL is
*the* lever: rendered output is stable for minutes while browser time is metered.
A `?cache=<seconds>` opt-in keeps it off by default, and nothing with a cookie or
`Authorization` is ever cached.

**What changed from today's `worker.js`:**

1. the dead branch at `worker.js:53` (`cf-connecting-ip` is checked after it has
   already been filtered out by `headersToRemove`, so the random-IP code at
   `:24-26` never runs);
2. the header removal list is futile against `Cf-Worker`, `Cf-Ray`, `Cdn-Loop`,
   `Cf-Ew-Via`, `Cf-Visitor` — the edge re-adds them on egress (`proofs/02`
   shows all five arriving at httpbin);
3. the UA swap at `:19-21` only fires for curl/wget/short UAs and leaves every
   other browser hint inconsistent with it, which is worse than not swapping;
4. no rendering path, no caching, no challenge detection, no solver hooks.

---

## 8. Reference implementation

`reference/` — deployable as-is, no containers, one Worker, optional bindings.

```
reference/
  wrangler.jsonc               browser + AI bindings, custom domain, 30s CPU
  package.json                 type: module, test: node --test
  src/index.js                 router: parse, engine pick, cache, escalate, headers
  src/lib/detect.js            classify() + solverPlan(); pure, 8 tests
  src/lib/profiles.js          b-ids-measured UA/sec-ch-ua/header order; strip list
  src/lib/cache.js             Cache API get/put, cacheability rules
  src/lib/engines/fetch.js     T0: ordered headers, subrequest, relay
  src/lib/engines/tls.js       T0s: seam for a userland TLS/HTTP2 transport
  src/lib/engines/render.js    T1/T2: quickAction() + Puppeteer session + page hooks
  src/lib/solvers/index.js     plan dispatch; audio in-page flow
  src/lib/solvers/ocr.js       Workers AI vision -> captcha text
  src/lib/solvers/audio.js     Whisper -> normalised answer
  src/lib/solvers/turnstile.js inspect + wait-for-self-issue + honest capability
  test/tls13-kat.test.mjs      RFC 8448 / RFC 7748 known-answer tests for tools/tls13-client.mjs
  test/clienthello.test.mjs    the ClientHello is a function of the profile: stable set, shuffled order
  test/*.test.mjs              47 tests, all passing
```

Status: `node --test` → **47 pass, 0 fail** (`proofs/06-tests.txt`), and the
same 47 pass with every socket entry point poisoned (`tools/no-network.mjs`).
Syntax is checked on every source file. Nothing was deployed.

`lib/engines/tls.js` is deliberately a seam and not an implementation. It wires
`env.TLS_TRANSPORT` into the ladder, refuses rather than downgrading when the
binding is missing, and shapes headers with the same profile helper the fetch
engine uses so the headers and the ClientHello cannot describe different
browsers. What it does *not* do is implement TLS: that is `tunnelfetch`'s or
`rustls`-in-WASM's job, and adopting one is a measurement exercise, not a
rewrite. What `test/tls13-kat.test.mjs` verifies is `tools/tls13-client.mjs` —
the proof instrument from §2, Layer 1 — against RFC 8448 and RFC 7748, including
the sequence-number-1 record that exposed the AES nonce bug.

Deploy:

```sh
cd reference
npm i -D wrangler
npx wrangler deploy            # binds BROWSER + AI, routes api.rv.pkgforge.dev
```

Sensible production defaults for `pkgforge`: keep T0 as the public default,
enable `?engine=render` for callers who need it, add `engine=tls` behind a flag
once the per-page CPU is measured on a real zone, and gate `engine=session`
behind a key so a stranger cannot spend the browser-hours budget.

---

## 9. Pricing

### 9.1 Published rates (all captured 2026-10-13)

| product | rate | source |
| --- | --- | --- |
| Workers Paid floor | $5/mo; 10M req + 30M CPU-ms included; +$0.30/M req, +$0.02/M CPU-ms | Workers pricing |
| Browser Run | 10 h/mo free, then **$0.09/browser-hour** | Browser Run pricing |
| Browser Run concurrency | 10 incl., then **$2.00** per extra concurrent browser (monthly average) | Browser Run pricing |
| Browser Run free plan | 10 min/day | Browser Run limits |
| Workers AI | 10,000 neurons/day free, then **$0.011 / 1,000 neurons** | Workers AI pricing |
| Whisper `large-v3-turbo` | 46.63 neurons / audio-minute (~$0.0005) | Workers AI pricing |
| moondream 3.1 9B | 27,273 neurons / M input tokens (=$0.30/M) | Workers AI pricing |
| Browser Use browser | **$0.02/browser-hour**, 1-min minimum | Browser Use pricing |
| Browser Use residential | **$5.00/GB**; direct/BYO **$0.20/GB** | Browser Use pricing |
| Jina Reader | free at 20 RPM; 500 RPM w/ free key (10M free tokens) | Jina reader |
| residential proxy, bought direct | $0.65/GB (ThorData bulk) … $1.75/GB (IPRoyal bulk) | vendor pages |
| small always-on VPS | ~$5/mo | market |

### 9.2 Cost per 1,000 pages

From `tools/cost-model.py` (`proofs/07`), 2 s browser time and 1.5 MB/page:

| option | USD / 1,000 pages | what it buys |
| --- | --- | --- |
| Workers fetch only | **0.0000** | no browser, no IP change |
| CF Browser Run (Quick Action) | **0.0500** | real Chromium; 18,000 pages/mo inside the free 10 h |
| Browser Use + residential | **7.3353** | real Chromium **+ residential IP** |
| Browser Use + direct/own proxy | 0.3041 | same browser, datacenter egress |
| DIY VPS + residential (bulk) | 1.0021 | you operate the Chrome and the proxy |
| DIY VPS + residential (retail) | 2.6135 | same |
| Jina Reader (no key) | 0.0000 | 20 RPM ceiling |

At 100,000 pages × 3 s × 2 MB, same model: Browser Run **$7.50** ($27.50 at 20
concurrent sessions), Browser Use + residential **$978.23**, DIY bulk-residential
**$131.95**.

### 9.3 The two facts that decide the budget

**Bandwidth, not browser time.** Browser Use's own rate is *cheaper* than Browser
Run's ($0.02/h vs $0.09/h), and it is still ~150× more expensive per page,
because at 1.5 MB/page the residential traffic costs $7.32 while the browser time
costs $0.011. If you buy T5, buy bytes, not browsers.

**Browser time is nearly free; concurrency is not.** 0.56 browser-hours is
$0.05. Going to 20 concurrent sessions adds $20/100k pages of concurrency charge
against $7.50 of actual browser time. Reuse one session and open tabs: tabs do
not count against concurrency, only against the session's memory.

### 9.4 Feature parity we can match at $0 or near-$0

| feature | provider | what it costs them | our parity | our cost |
| --- | --- | --- | --- | --- |
| JS rendering | Jina / Browser Use / CF | browser-hours | Browser Run Quick Action | **$0** up to 18k pages/mo |
| URL → clean markdown | Jina Reader | same + model | `/markdown` Quick Action | $0 |
| Screenshot / PDF | CF / Browser Use | browser-hours | `/screenshot`, `/pdf` | $0 |
| Structured extraction | CF `/json` | Workers AI | `/json` or our own prompt | ~$0.01/M tokens |
| Crawl + follow links | CF `/crawl` | browser + R2 | Queues + Browser Run | $0 (Queues free tier) |
| Image-captcha solve | paid solvers | worker farm | Workers AI vision | **$0.12 / 1,000** |
| Audio-captcha solve | paid solvers | worker farm | Workers AI Whisper | **$0.10 / 1,000** |
| Response caching | provider-side | their cache | Cache API | $0 |
| Residential IP | BrightData/ThorData/BU | **$0.65–8/GB** | **none** | ✗ |
| Pass hard anti-bot | browser-use 81% claim | residential + patched Chrome | **none** | ✗ |
| TLS/JA4 impersonation | Jina (in-house) | curl-impersonate | `engine=tls` + a userland transport | **$0 + CPU** |

**Verdict on parity:** everything except the two red rows. Both are IP-shaped —
the handshake can be built, the address cannot — and the only route past them is
to rent a browser on someone else's network: cheapest credible entry is DIY
Chrome + bulk residential at ~$1.00/1000 pages, or Browser Use at ~$7.34/1000
with zero operations.

---

## 10. Recommendations

1. **Ship T0+T1+T3 now.** They cost $5/month, add a real Chromium path, cache
   aggressively, and cover the large majority of URLs. This is a strict superset
   of what `api.rv.pkgforge.dev` does today, at the same price.
2. **Stop the free own-goal first, before any tier work.** `worker.js:15` sends a
   Safari User-Agent over a Cloudflare handshake. Either construct the handshake
   (below) or send a User-Agent that matches the transport. This is one line and
   it removes the loudest tell in the request.
3. **Add the userland-TLS path as an opt-in engine (T0s), not a rewrite.** The
   transport is the only new thing; the ladder, cache and audit headers stay.
   Prefer adopting `tunnelfetch` (or rustls-WASM as in `socksflare`) over writing
   a TLS stack — tunnelfetch cannot run on workerd's six-connection limit
   unchanged, so measure the CPU per page and gate the engine behind a flag.
   Do not present a userland TLS hello over a non-matching header set; that is
   worse than the honest default.
4. **Do not chase "100% real browser".** The egress IP is still Cloudflare's and
   Browser Run still signs its requests. Optimise the *reachable* fraction and
   report the rest honestly (`X-Rv-Challenge`, and `human:handoff` as unsolved).
5. **Make T5 an explicit, metered escape hatch**, not the default. One route,
   one API key, a bytes budget. Never let a caller spend browser-hours or
   residential GB through the public endpoint.
6. **Re-fetch the profiles monthly.** `node tools/bids-profile.mjs` fails on
   drift; wire it into CI. A profile that quietly goes stale is exactly the
   HeadlessChrome/151 trap described in §3.4. The same applies with more force
   to a ClientHello: `tools/tls13-client.mjs` is a fingerprint *shaper*, and a
   shaper needs a recent capture, not a remembered one.
7. **If a target needs layer 5, the Worker is the wrong tool.** A small
   always-on box running patched Chrome behind a bulk residential proxy is
   ~$1 per 1,000 pages with full control, and no amount of Worker engineering
   substitutes for the IP. Neucom Sphere would put that box in Port Edwards and
   call it a department.

---

## 11. Reproduce

```sh
sh tools/reproduce.sh                              # everything below, into proofs/
python3 tools/ja4.py evidence/bids/routes_client-hello-hex_chrome_stable_latest_linux64.txt
python3 tools/cost-model.py --pages 100000 --seconds 3 --mb 2 --concurrent 20
node tools/bids-profile.mjs                        # verify profiles vs upstream
node tools/tls13-client.mjs                        # userland TLS, two fingerprints
cd reference && node --test test/*.test.mjs        # 47 tests
```

The third-party trees this document cites by `file:line` are not shipped (two of
them are GPL-3.0 and one is CC-BY-NC-4.0). Fetch them at the exact commits the
citations were taken from:

```sh
sh tools/fetch-repos.sh                            # -> repos/<name>, git-ignored
```

`tools/tls13-client.mjs` needs the Electrosphere; the known-answer tests do not.
To regenerate the RFC 8448 vectors, fetch the RFC and run
`python3 tools/rfc8448-extract.py rfc8448.txt > reference/test/vectors/tls13-kat.json`.
Everything else in the list is offline once the proofs exist.

To confirm the reference test suite is hermetic rather than merely passing on a
machine that happens to be online:

```sh
cd reference && node --import ../tools/no-network.mjs --test test/*.test.mjs
```

`proofs/06-tests.txt` holds both runs. The proofs are named `01`–`09`; the index
in `README.md` maps each to its file.

`node` was a static build unpacked outside the tree; no global install was made.

---

## 12. Scope and limits

- **Nothing was deployed and no Cloudflare account was touched.** All Browser Run
  behaviour is from Cloudflare's own docs and a first-party marketing page.
- **The userland handshake was proved in Node, not on workerd.**
  `tools/tls13-client.mjs` runs over a raw `net.Socket`; the claim it supports —
  that a program holding only a byte stream can choose its ClientHello — is
  exactly the property `connect()` provides, and the RFC 8448 known-answer tests
  fix the crypto independently of the socket. What is *not* measured here is the
  CPU cost of the same stack inside a Worker. The only edge-measured numbers in
  §2, Layer 1 are `tunnelfetch`'s, and its HTTP/2 cost measurements are its own.
- **The proof client is not a browser.** It reproduces the *cipher* half of
  Chrome's JA4 exactly (`8daaf6152771`); its extension set is partial, ALPN is
  `http/1.1` where Chrome sends `h2`, it does only X25519 (no `X25519MLKEM768`),
  and it does not verify certificates. It is an instrument for demonstrating
  that the fingerprint is a parameter, not a candidate for production.
- **Neither prior-art project has been independently audited.** `tunnelfetch`
  says so itself (`README.md:15-21`) and `socksflare` labels itself experimental.
  The claim here is only that userland TLS on Workers is real and working, not
  that either implementation is trustworthy.
- **No stealth pass-rate is claimed for any tier.** The structural ceiling is
  §2/§4; a number would need a deployed zone and a target corpus.
- **Header order is unverified end to end.** `workerd` preserves `Headers`
  insertion order; Node's `undici` sorts keys, so the unit tests assert on the
  ordered pair list rather than on a serialised request. Whether the Cloudflare
  edge preserves our order on the wire is untested.
- **The b-ids Chrome ClientHello capture has no SNI** (`t13i…`, not `t13d…`), so
  its JA4_a reads `t13i1516h2`. The cipher and extension hashes are unaffected
  and are what the argument uses.
- **Jina's per-token price is not cited** because the table is client-rendered
  and absent from the served HTML. Free-tier RPM and token grants are cited.
- **JA3 was discarded** as a comparison metric after observing it change between
  two identical requests from the same client while JA4 held — an observation
  that, in hindsight, also pointed at hand-constructed ClientHellos (§2).
- **Latency figures are from one vantage point** and are indicative only.
- **Legal/ToS.** Solving a challenge on a site that forbids automated access can
  breach that site's terms and, in some jurisdictions, computer-misuse law. The
  solvers here automate an accessibility feature on pages the caller is already
  authorised to reach; that does not make every target authorised. The reference
  implementation reports unsolved challenges rather than retrying them
  indefinitely, and rate-limits the session tier for that reason.

---

## 13. Sources

Cloudflare — docs fetched 2026-10-13, markdown form:
`browser-run/{index,get-started,quick-actions,quick-actions/content-endpoint,pricing,limits,faq,kitesurf,changelog,features/outbound-workers,features/guardrails,reference/automatic-request-headers}`,
`workers/runtime-apis/tcp-sockets`, `workers/platform/{pricing,limits}`,
`workers-ai/platform/pricing`, `turnstile`, `turnstile/get-started/server-side-validation`,
`changelog/rss/index.xml`, `cloudflare.com/products/browser-run/`.

Repositories, cloned 2026-10-13:
- `jina-ai/reader` @ `1574bfd` — `src/services/curl.ts`, `src/services/proxy-provider/index.ts`,
  `src/services/cf-browser-rendering.ts`, `src/services/minimal-stealth.js`,
  `src/dto/crawler-options.ts`, `src/api/crawler.ts`
- `browser-use/browser-use` @ `c75e847` — `pyproject.toml`, `README.md`, `llms.txt`, `pricing.md`
- `pkgforge-dev/reverse-proxies` @ `03f6d1d` — `api.rv.pkgforge.dev/worker.js`
- `Azathothas/b-ids` — `main` @ `43c73e8` for tooling/docs; corpus values fetched
  raw from the generated `data` branch (`routes/*`, `corpus/v1/latest.json`)
- `munew/cloudflare-turnstile-solver` — `README.md`, `Cargo.toml`, `src/solver/task_client.rs`
- `latentharbor/tunnelfetch` @ `81b75f3` — userland TLS 1.2/1.3 and HTTP/2 for
  Workers; `README.md` (measured edge numbers), `src/tls/*`, `src/http2/*`,
  `src/profiles.js`, `src/profile/chrome.js`, `src/profile/vendor/*`
- `EithonX/socksflare` @ `62fba5f` — rustls compiled to WASM;
  `README.md`, `rust-tls-wasm/src/lib.rs`

Standards, used as known-answer tests rather than documentation:
- RFC 8448, *Example Handshake Traces for TLS 1.3*, §3 — key schedule and
  record vectors, extracted by `tools/rfc8448-extract.py`, kept at
  `docs/rfc8448.txt`
- RFC 7748, §6.1 — X25519 vector
- RFC 8446 §5.3 and §7.1 — record nonce construction and key schedule

Live probes: `tls.peet.ws/api/all`, `httpbin.org/headers`, `ip.pkgforge.dev/json`,
`nowsecure.nl`, all fetched through the proxy or through `r.jina.ai` on 2026-10-13;
raw output in `proofs/`. `tools/tls13-client.mjs` also probes `tls.peet.ws`
directly, to read back the fingerprint the server saw.
