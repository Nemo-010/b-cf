# `api.rv.pkgforge.dev` v2 — research tree

Start with **[RESEARCH.md](./RESEARCH.md)**. It is the whole argument, with the
evidence inlined and every number traced to a proof.

## Layout

| path | what it is |
| --- | --- |
| `RESEARCH.md` | the research document: verdict, detection stack, product comparison, solver taxonomy, architecture, pricing, limits |
| `reference/` | a deployable Worker implementing the design in §7–8; 47 passing tests |
| `tools/tls13-client.mjs` | a minimal TLS 1.3 client with a controllable ClientHello — the proof that a raw socket can pick its own fingerprint (§2, Layer 1) |
| `tools/rfc8448-extract.py` | pulls the RFC 8448 §3 key-schedule and record vectors used as known-answer tests |
| `tools/ja4.py`, `tools/ja3.py` | JA4/JA3 computed from a raw TLS ClientHello, from first principles |
| `tools/bids-profile.mjs` | verifies the shipped browser profiles against the live b-ids corpus; fails on drift |
| `tools/cost-model.py` | the pricing model behind §9 |
| `tools/fetch-repos.sh` | fetches the cited third-party trees at pinned commits (§ *Cited trees*) |
| `tools/no-network.mjs` | poisons every socket entry point, to prove the test suite is hermetic |
| `tools/reproduce.sh` | regenerates every number and proof |
| `tools/h2t.py` | the HTML→text helper used when the raw page captures were made |
| `proofs/` | captured output cited by the document; indexed below |
| `evidence/` | the two upstream artefacts used as inputs, mirrored verbatim |
| `docs/` | Cloudflare, Jina and Browser Use documentation captured on 2026-10-13; see `docs/MANIFEST.md` |
| `docs/rfc8448.txt` | RFC 8448, kept so the TLS known-answer tests can be regenerated offline |

## Proofs

| file | what it shows |
| --- | --- |
| `proofs/01-api-rv-tls.{json,txt}` | the TLS/JA4 an origin sees through the current proxy |
| `proofs/02-api-rv-headers.{json,txt}` | the headers an origin sees through the current proxy |
| `proofs/03-jina-tls.txt` | `r.jina.ai`'s TLS fingerprint, for comparison |
| `proofs/04-bids-ja4.txt` | JA4 computed from the b-ids raw Chrome ClientHello |
| `proofs/05-bids-profiles.txt` | shipped profiles vs the b-ids corpus (drift check) |
| `proofs/06-tests.txt` | the 47-test suite, run twice: normally and with the network poisoned |
| `proofs/07-cost.txt` | the cost model's output |
| `proofs/08-jina-nowsecure.txt` | Jina Reader on a Cloudflare-protected page |
| `proofs/09-userland-tls-fingerprints.txt` | one userland TLS program emitting two different JA4s. Not byte-reproducible: the chrome profile shuffles its extension order per connection, as Chrome does, so its *JA3* line is one sample of a distribution while its JA4 is fixed. |

## Regenerate and verify

```sh
sh tools/reproduce.sh                               # every proof; fetches are non-destructive
python3 tools/cost-model.py --pages 100000 --seconds 3 --mb 2 --concurrent 20
cd reference && node --test test/*.test.mjs         # 47 tests, no network

# the suite is hermetic, not merely passing while online:
cd reference && node --import ../tools/no-network.mjs --test test/*.test.mjs
```

`sh tools/reproduce.sh` writes fetches to a temporary file and only replaces a
committed proof when the fetch returned a real `200` with a plausible body, so
running it offline leaves the checked-in evidence intact and says which steps it
skipped.

Not every proof is byte-reproducible, and the difference is worth stating rather
than hiding. `04`, `05`, `06`, `07` and `08` are byte-identical from a fresh
clone. `01`, `02`, `03` and `09` carry live data, so they differ in the
per-request parts - an ephemeral source port, `Cf-Ray`, an AWS trace id - while
the fields the document actually reasons about are stable across independent
runs. In particular `api.rv.pkgforge.dev` reports the same JA4
(`t13d1312h2_a44d0ee8b3cc_e381dae6da6b`) on every run. `09` is a sample of a
randomised distribution by design: its `chrome` profile shuffles extension order
the way Chrome does, which is exactly the property
`reference/test/clienthello.test.mjs` pins down.

## Cited trees

`RESEARCH.md` cites third-party files by `file:line`. Those trees are **not
shipped**: `jina-ai/reader` is all-rights-reserved, `EithonX/socksflare` and the
munew Turnstile solver are GPL-3.0, and Theyka's solver is CC-BY-NC-4.0. Fetch
them at the exact commits the citations were taken from:

```sh
sh tools/fetch-repos.sh                             # -> repos/<name>, git-ignored
```

## Evidence provenance

`evidence/bids/` holds two files mirrored verbatim from the `data` branch of
`Azathothas/b-ids` (0BSD-style permissive). They are byte-identical to
upstream as of 2026-10-13 and re-checked by `tools/reproduce.sh` step 4:

- `corpus_v1_latest.json` ← `corpus/v1/latest.json`
- `routes_client-hello-hex_chrome_stable_latest_linux64.txt` ← `routes/client-hello-hex/chrome/stable/latest/linux64.txt`

## Third-party content and licence

This repository's own text, tools and reference implementation are MIT — see
`LICENSE`. The captured documentation under `docs/` and the two artefacts under
`evidence/` remain the property of their authors and are included only as
quotable primary sources; `docs/MANIFEST.md` records the source URL and status of
each file.

Nothing here was deployed. See RESEARCH.md §12 for the full scope statement.
