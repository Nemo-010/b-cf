# reference — api.rv.pkgforge.dev v2

A single Cloudflare Worker that keeps the existing
`https://api.rv.pkgforge.dev/<url>` contract and adds a render path, challenge
detection, response caching and two serverless solvers.

## Design in one paragraph

`fetch()` is the default and costs nothing; only a detected gate escalates to
Browser Run, and only a challenge escalates to a session with a solver. Every
response says which path produced it, so the routing is auditable in production.
The implementation never reports a solved challenge it did not solve.

## Bindings

`wrangler.jsonc` declares:

| binding | required | used by |
| --- | --- | --- |
| `BROWSER` | for `engine=render` / `engine=session` | `lib/engines/render.js` |
| `AI` | for the solvers | `lib/solvers/{ocr,audio}.js` |
| `TLS_TRANSPORT` | for `engine=tls` | `lib/engines/tls.js` |

`CF_ACCOUNT_ID` and `CF_API_TOKEN` are the optional REST fallback used by
`lib/engines/render.js` when no `BROWSER` binding is present. They are read only
on that path; without them and without `BROWSER`, `engine=render` fails loudly.
They are not declared in `wrangler.jsonc` on purpose — put the token in a
secret, not in `vars`.

Without `BROWSER` the Worker still serves tier 0; the health endpoint reports
which capabilities are live. Without `AI`, `browser:audio` returns unsolved
rather than throwing.

## API

```
GET /                                  health + capability report
GET /https://example.com               auto: fetch, escalate if gated
GET /example.com?engine=render         force Browser Run
GET /https://example.com?engine=fetch  force tier 0
GET /https://example.com?engine=tls    force userland TLS (needs env.TLS_TRANSPORT)
GET /https://example.com?cache=600     allow 600 s of response caching
    header: X-Rv-Engine: fetch|tls|render|markdown|session|auto
    header: X-Rv-No-Escalate: 1        never render
    header: X-Rv-Profile: chrome-155-linux|chrome-155-win64
```

Response meta: `X-Rv-Engine`, `X-Rv-Ms`, `X-Rv-Challenge`, `X-Rv-Profile`,
`X-Rv-Cache`.

## Test

```sh
node --test test/*.test.mjs
```

47 tests: challenge classification, header order and values against the b-ids
captures, solver normalisation, routing, escalation, the no-escalate and
render-failure paths, the tier-0s transport contract, the RFC 8448/7748
known-answer tests for `tools/tls13-client.mjs`, and the offline properties of
the ClientHello that client builds. No network and no Cloudflare
account required — and that is checkable rather than asserted:

```sh
node --import ../tools/no-network.mjs --test test/*.test.mjs
```

## Tier 0s: `engine=tls`

`lib/engines/tls.js` is a **seam, not a TLS implementation**. It is where a
userland transport plugs in — the only way a Worker can present a browser
ClientHello, since `fetch()` has no TLS surface and `connect({ secureTransport:
'off' })` is a raw byte stream. Bind `env.TLS_TRANSPORT` to something shaped like
`latentharbor/tunnelfetch` or `EithonX/socksflare`:

```js
env.TLS_TRANSPORT = new Client({ connect, trust: { mode: 'system' } });
```

It is never selected by `auto`: it costs a handshake of CPU per request, and a
caller who asks for it gets an error rather than a silent downgrade to the
transport they were avoiding. Header order comes from the same profile helper as
the fetch engine, so the headers and the ClientHello cannot describe different
browsers. See `RESEARCH.md` §2, Layer 1 for the evidence.

## Deploy

```sh
npm i -D wrangler
npx wrangler deploy
```

`@cloudflare/puppeteer` is an optional dependency, imported lazily only by
`engine=session`, so a fetch/render-only deployment does not install it.
