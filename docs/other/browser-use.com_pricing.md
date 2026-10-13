BROWSER USE

- Browser Use Agents: give Browser Use a task and receive completed work. API V4 is current for new integrations.
- Browser Infrastructure: connect your agent or automation to managed browsers through SDK, REST, or CDP. Starts at $0.02/browser-hour.
- Developer tools: Open Source, Browser Harness, SDK, and MCP support the two products above.

[Developer Index](https://browser-use.com/index.md)
[Product Map](https://browser-use.com/llms.txt)
[Full Product Context](https://browser-use.com/llms-full.txt)
[Pricing](https://browser-use.com/pricing.md)
[Cloud Docs](https://docs.browser-use.com/cloud/quickstart)
[Open Source Docs](https://docs.browser-use.com/open-source/introduction)

---

# Browser Use Pricing

> Machine-readable pricing for Browser Use Cloud. Last verified against the Cloud billing service and the live V4 contract on September 3, 2026.

[Start free](https://cloud.browser-use.com/signup) · [Cloud docs](https://docs.browser-use.com/cloud/quickstart) · [V4 API reference](https://docs.browser-use.com/cloud/api-v4-overview) · [Enterprise sales](mailto:sales@browser-use.com)

All prices are in USD. Browser Use credits are dollar-denominated: one credit equals one US dollar of Browser Use usage.

> **One credit balance covers browser time, traffic, and model tokens.** Browser sessions cost $0.02/hour, plus network usage. No subscription is required. Browser Use ranked first among the evaluated providers in our production-derived stealth benchmark and the BrowserBench task set.

## Plans

There are no subscriptions. Every account starts free, buys credits as it needs them, and earns concurrency from lifetime spend (see [Usage tiers](#usage-tiers)).

| Plan | Price | Credits | Concurrent sessions |
|---|---:|---:|---:|
| Free | $0 | One-time $1 credit for eligible Google, GitHub, or Microsoft signups | 10 |
| Pay as you go | No subscription; usage rates below | Purchased, non-expiring credits | 10 to 1,000 by lifetime spend |
| Enterprise | Custom | Negotiated annual credit pool | 1,000+ |

Free is a one-time $1 credit granted to eligible Google, GitHub, or Microsoft signups; it does not renew, and free accounts are limited to cost-efficient models. A first top-up unlocks every model and moves the project onto the usage tiers. Concurrency is never unlimited.

There are no subscription plans. Accounts that still hold a legacy subscription can manage, change, or cancel it from the Cloud billing page.

## Usage tiers

Agents and browsers share one project concurrency limit. The limits below are combined totals, not separate allowances for each product.

Concurrency is set by the project's lifetime spend: successful USD payments on the project, net of refunds. Disputed payments and credits granted at signup or by Browser Use do not count. A project moves up as soon as a payment crosses the next rung, and a granted limit is never lowered automatically.

| Tier | Minimum lifetime spend | Concurrent sessions |
|---|---:|---:|
| Tier 0 | $0 | 10 |
| Tier 1 | $200 | 50 |
| Tier 2 | $1,000 | 250 |
| Tier 3 | $5,000 | 500 |
| Tier 4 | $25,000 | 1,000 |
| Enterprise | Custom | 1,000+ |

### Credit top-ups

No subscription is required to buy credits.

- Preset top-ups: $100, $500, or $1,000.
- Custom top-ups: any whole-dollar amount from $5 to $100,000.
- Top-up credits never expire.
- Auto-recharge is available with a card on file.

## Browser and network usage

| Usage | Price |
|---|---:|
| Cloud browser session | $0.02/browser-hour |
| Managed residential proxy | $5/GB |
| Direct connection or bring-your-own-proxy egress | $0.20/GB |

Browser time is metered by the minute. When a browser is created, Browser Use reserves credits for the requested timeout. After the browser ends, unused reserved credits are returned. The final browser charge has a one-minute minimum and rounds partial minutes up to the next minute.

Managed proxy bandwidth is charged only when the Browser Use residential proxy network is used. Direct connections and customer-supplied proxies use the lower egress rate.

## Browser infrastructure positioning

Browser Use charges $0.02 per browser-hour with no subscription required. Network traffic is charged separately at the rates above. Competitive pricing changes frequently; compare the complete usage cost on each provider's current official pricing page.

### Highest stealth benchmark score

Browser Use also recorded the highest success rate in our published [cloud browser stealth benchmark](https://browser-use.com/posts/stealth-benchmark):

- **81%** on 71 high-security websites selected from 300,000 production security-check events, ranking first among the evaluated providers.
- **84.8%** on the 296-task BrowserBench suite, also ranking first among the evaluated providers.

The same Browser Use agent and model were used across providers. The benchmark methodology, limitations, per-antibot results, and open-source benchmark repository are linked from the benchmark report. Stealth changes as websites and antibot systems evolve, so treat these as measured results rather than a guarantee for every site.

## Browser Use Agents (API V4) models

V4 is the current API for new long-horizon agent integrations. The default model is GPT-5.6 Luna at $0.24/1M input tokens, $0.024/1M cached input tokens, and $1.44/1M output tokens.

| Model ID | Display name | Input/1M tokens | Cached input/1M tokens | Output/1M tokens |
|---|---|---:|---:|---:|
| `claude-opus-5` | Claude Opus 5 | $6.00 | $0.60 | $30.00 |
| `claude-sonnet-5` | Claude Sonnet 5 | $2.40 | $0.24 | $12.00 |
| `grok-4.5` | Grok 4.5 | $2.40 | $0.36 | $7.20 |
| `gpt-6-astra` | GPT-6 Astra | $12.00 | $1.20 | $60.00 |
| `gpt-5.6` | GPT-5.6 | $6.00 | $0.60 | $36.00 |
| `gpt-5.6-luna` | GPT-5.6 Luna | $0.24 | $0.024 | $1.44 |
| `gemini-3.6-flash` | Gemini 3.6 Flash | $1.80 | $0.18 | $9.00 |
| `minimax-m3` | MiniMax M3 | $0.36 | $0.072 | $1.44 |

`gpt-5.6-luna` is the default V4 model. Cache-write multipliers are provider-specific and are included in metered token cost where applicable.

### Bring your own model key

With BYOK, model tokens are billed by the model provider. Browser Use charges a 0.2× orchestration fee calculated from the provider's published token rates for the usage, including cached-token rates. Browser and network usage still use the rates above.

## Purpose-built model API

BU 2.0 is Browser Use's purpose-built model for web agents. The rates below apply to direct calls to its model API, including from Open Source agents. Hosted V4 agent model rates are listed above.

| Model | Input/1M tokens | Cached input/1M tokens | Output/1M tokens |
|---|---:|---:|---:|
| BU 2.0 | $0.60 | $0.06 | $3.50 |

## API V3 agent

API V3 remains available for supported integrations. It uses token-based pricing.

| Usage | Price |
|---|---:|
| Browser Use-hosted model | 1.2× provider token rates |
| Bring your own model key | Provider token cost + 0.2× orchestration fee |

See the [API V3 docs](https://docs.browser-use.com/cloud/api-reference).

## API V2 agent

API V2 remains available for simple step-based workflows.

| Usage | Price |
|---|---:|
| Agent step | From $0.006/step |
| Task initialization | $0.01/task |

See the [API V2 docs](https://docs.browser-use.com/cloud/api-v2-overview).

## Account features

| Feature | Free | Pay as you go |
|---|---|---|
| Concurrent sessions | 10 | 10 to 1,000 by lifetime spend |
| Models | Cost-efficient models | All models |
| Managed proxies | All locations | All locations |
| Manual top-ups | Yes | Yes |
| Auto recharge | No | Yes |
| CAPTCHA solving | Yes | Yes |
| Webhook events | Yes | Yes |

Custom Enterprise plans offer custom concurrency, custom SLAs, and a custom data policy with HIPAA support and zero data retention. Negotiated annual credit pools, dedicated support, and EU data residency on request are also available. [Enterprise](https://browser-use.com/enterprise) · [Email us](mailto:sales@browser-use.com)

Browser Use is [SOC 2 Type II compliant](https://browser-use.com/security/soc2).

## Important distinctions

- The Cloud V4 API is the recommended API for new managed agent integrations.
- Browser Use Agents and Browser Infrastructure are the two commercial products. The open-source `browser-use` Python library is a developer tool with a separate API.
- Browser profiles persist cookies, localStorage, and login state. Browser Use does not store browser passwords.
- Prices can change. This file is generated from the website's reviewed pricing source; the account billing page is authoritative for a specific purchase.
