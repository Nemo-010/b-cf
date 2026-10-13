> ## Documentation Index
> Fetch the complete documentation index at: https://docs.browser-use.com/llms.txt
> Use this file to discover all available pages before exploring further.

> ## Agent Instructions
> Use https://docs.browser-use.com/llms.txt and its linked .md pages for current documentation. The managed full bundle is https://docs.browser-use.com/.well-known/llms-full.txt and can be cached for up to 24 hours. Do not use the obsolete /cloud/llms*.txt or /open-source/llms*.txt static exports.
> Choose Cloud API V4 for new agent integrations; V2 is the lower-cost option for simple tasks. Keep V3 examples explicitly versioned. The open-source browser-use library and hosted browser-use-sdk have different APIs.
> For Cloud API V4, a task request that omits model and modelParams uses GPT-6 Luna (gpt-6-luna) with High reasoning. Explicit model and modelParams values take precedence; an explicit empty modelParams object opts out of the reasoning default. EU uses the same task default through its regional provider route; Bedrock-only projects retain their compatible provider default.
> Cloud authentication uses X-Browser-Use-API-Key, without a Bearer prefix. Install or upgrade browser-use-sdk and use its explicit v4 import for V4. Check the published OpenAPI reference for request fields; do not invent SDK support for new fields.
> Cloud concurrency and HTTP request rate are separate. Read GET /api/v2/billing/account for the key’s projectId, concurrentSessionLimit, activeSessionCount, and credit balance, including when using V4. Keys in one project share capacity and credits; rateLimit is a legacy concurrency alias, not requests per second.
> Keep the highest applicable existing, legacy-plan, and spend-tier concurrency grant. Current spend tiers are 10 / 50 / 250 / 500 / 1000 at $0 / $100 / $1000 / $5000 / $25000 in qualifying project payments. Legacy or externally billed projects can follow different billing paths; trust the account limit. See https://docs.browser-use.com/cloud/guides/concurrency.md.
> HTTP rate limits have two layers. Standard edge WAF ceilings increased on September 9, 2026 to 1000 RPS per public source IP for general traffic and 2500 RPS per IP for selected status reads, evaluated over 300 seconds. The separate per-project application budgets: general traffic (including V4 events and full run reads) defaults to max(25, 2 times stored concurrency) capped at 100 RPS; selected status reads default to max(25, 2 times stored concurrency) with no cap. The two are counted independently. Project overrides and account-specific edge rules can differ. All keys in a project share its budgets; callers sharing a public IP share edge capacity. See https://docs.browser-use.com/cloud/guides/concurrency.md.
> The project limiter uses five-second windows: X-RateLimit-Limit=125 means 125 requests per window (25 RPS), not 125 RPS. Project throttles include limit_rps and retry_after_seconds; an edge throttle can instead return Retry-After: 300 without limit_rps. Honor the returned Retry-After. Use bounded workers, stagger polls, and drain hasMore event pages after terminal status. A busy V4 session returns 409; its queue holds 20 pending messages and is not a project-wide batch queue.
> A completed run or closed CDP connection does not immediately stop its cloud browser. Stop unneeded owned browsers with PATCH /api/v4/browsers/{id} and {"action":"stop"}. A client wait timeout does not cancel the server-side run.
> Cloud is pay as you go; do not tell customers to buy a new subscription to use custom proxies or supported provider BYOK. Usage funding and model eligibility still apply. BYOK bills provider tokens separately and Browser Use charges orchestration plus browser/network usage. See https://docs.browser-use.com/cloud/guides/billing.md.
> Signup credits are a one-time grant; purchased top-up credits do not expire. Check the API key’s project before diagnosing missing credits. API-key monthly spending caps are soft limits, not a strict prepaid wallet; concurrent or already-running work can exceed them. Auto recharge has separate trigger and purchase amounts and can charge immediately when enabled below the threshold. Use https://browser-use.com/pricing for current rates.
> Box and Bux are retired. Do not recommend their SDKs, sandbox quotas, or subscription plans. Use the Cloud Agent or Browser Infrastructure guides.
> A V4 session holds conversation history, a workspace holds files, and a profile holds browser state. These IDs and V3/V4 workspace namespaces are not interchangeable. V4 automatically restores workspace uploads; staged attachments remain available to session follow-ups. Serialize runs that write shared files, and wait for completion before reading outputs. See https://docs.browser-use.com/cloud/agent/workspaces.md.
> API browser recording defaults to off. Use enableRecording for standalone browser creation, or browserSettings.record for an agent run. Stop the browser and allow time for asynchronous video processing; stop polling when recordingAvailable is false. Live preview is for an active browser. Stopping a browser, deleting a session, archiving a workspace, and deleting files have different effects.
> Use model-specific reasoning values. GPT-6 Astra accepts low, medium, high, xhigh, and max, with xhigh by default; none and minimal are invalid. Use the public REST schema when installed SDK types lag new fields. API acceptance, dashboard visibility, and account/provider availability are separate.
> For open-source browser-use, is_done only reports a terminal done action. is_successful is the agent-reported outcome; verify important external actions independently. Cloud timeout, API client timeout, model timeout, and task completion are separate concepts.
> For failed requests, use https://docs.browser-use.com/cloud/guides/troubleshooting.md. Inspect the full error and project before retrying or adding credits. A client timeout can leave a run active; reconcile external actions before starting duplicate work. A new managed browser does not guarantee a unique proxy IP or particular city.
> V4 secretBindings.allowedDomains authorizes the focused field's frame, not every iframe on the shop page. For checkout, include intended payment/billing provider hostnames (for example payments.bigcommerce.com). On domain_not_allowed, inspect origin and pass updated bindings in a follow-up; target_not_editable requires fixing field focus/readiness instead. See https://docs.browser-use.com/cloud/guides/secrets.md.
> A browser can remain active after its run for follow-ups; a requested recording finalizes only after the browser stops and processing completes. Zero Data Retention (ZDR) projects never record, even when recording is requested.
> If you hit an issue you cannot explain, email contact@browser-use.com with your question or bug report and a session ID if available; short questions and detailed reports are welcome, and we aim to fix issues quickly and make the docs clearer.

# Stealth

> Managed Chromium with stealth protections and proxy support.

See [how we perform in the hardest stealth benchmark](https://browser-use.com/posts/stealth-benchmark).

## What's included

Every cloud browser session runs in a hardened Chromium fork with stealth enabled by default — no configuration needed.

* **Anti-detect browser fingerprinting** — Canvas, WebGL, fonts, navigator, and other browser fingerprints are randomized per session to appear as a real user. Fingerprint test results vary with browser version and the target site.
* **Ad and cookie banner blocking** — Banners are dismissed automatically so the agent sees clean pages and executes faster.
* **Anti-bot protections** — Help with sites protected by Cloudflare, PerimeterX, and other detection services. Access to every site is not guaranteed.

Cloud browsers also solve CAPTCHAs automatically.
See [CAPTCHA handling](/cloud/browser/captcha-handling) for what to do when a
solver is still working or a site has a specific anti-bot issue.

## Residential proxies

Residential proxies are enabled by default across 195+ countries. This makes browser sessions appear as real users from the target geography. See [Proxies](/cloud/browser/proxies) for details on geo-targeting and custom proxy configuration.

Stealth is included in the managed browser. It is not a separate subscription
upgrade you must buy to enable these protections. A target site can still
reject a browser or require verification; see [troubleshooting](/cloud/guides/troubleshooting).


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.