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

# Live preview & recording

> Watch an API V4 run in real time or record its browser.

Wait for `browser.ready` as soon as you create the run so the URL is available
while the browser is live:

<CodeGroup>
  ```python Python theme={null}
  from browser_use_sdk.v4 import BrowserUse

  client = BrowserUse()
  run = client.runs.create("Find the top Hacker News story")
  ready = client.runs.wait_for_event(run.id, "browser.ready", interval=3)
  print(ready.data["live_view_url"])
  ```

  ```typescript TypeScript theme={null}
  import { BrowserUse } from "browser-use-sdk/v4";

  const client = new BrowserUse();
  const run = await client.runs.create({
    task: "Find the top Hacker News story",
    model: "grok-4.5",
  });
  const ready = await client.runs.waitForEvent(run.id, "browser.ready", { interval: 3_000 });
  console.log(ready.data.live_view_url);
  ```
</CodeGroup>

These examples poll immediately, then every three seconds (Python uses seconds;
TypeScript uses milliseconds). Setting the interval explicitly also reduces
traffic on older SDK releases whose event default is one second. Event reads
share the project's general request budget; [stagger concurrent
waits](/cloud/guides/concurrency#when-you-need-events) and leave room for other calls.

The helper advances the event cursor and times out after five minutes. See [run
events](/cloud/agent/observability) for the full event stream and custom polling.

## Embed the live browser

```html theme={null}
<iframe
  src="{LIVE_VIEW_URL}"
  style="width: 100%; aspect-ratio: 16/9; border: 0;"
  allow="autoplay"
></iframe>
```

The URL is hosted on `live.browser-use.com`. Add that origin to your
Content Security Policy's `frame-src` directive when needed. Treat the URL as
a credential: anyone with it can interact with the active browser.

### Read-only embeds

To let users watch without clicking, typing, or scrolling the remote page,
make the iframe non-interactive in your application. This works with V4 today
and provides the same UI-level restriction as the V2 dashboard's view-only mode.
No API request parameter is needed.

Use `ready.data.live_view_url` from the V4 `browser.ready` event above.
For REST integrations, read that event from
[`GET /api/v4/runs/{run_id}/events`](/cloud/api-v4/runs/get-run-events).
Standalone [`POST /api/v4/browsers`](/cloud/api-v4/browsers/create-browser-session)
responses return the URL as `liveUrl`.

```html theme={null}
<div inert>
  <iframe
    src="{LIVE_VIEW_URL}"
    title="Live browser preview"
    tabindex="-1"
    style="width: 100%; aspect-ratio: 16/9; border: 0; pointer-events: none;"
    allow="autoplay"
  ></iframe>
</div>
```

The preview keeps streaming. The `inert` wrapper prevents focus and keyboard
input, while `pointer-events: none` blocks pointer interaction with the iframe.
Use a browser that supports `inert`. To allow human takeover, remove `inert`,
`tabindex="-1"`, and `pointer-events: none` when your application enables control.

<Note>
  `ui=false` only hides the tabs and toolbar; it does not disable interaction.
  View-only embeds are a UI restriction, not a server-enforced permission.
  Anyone who opens the live URL directly or uses the underlying CDP URL can
  still control the browser. Keep both URLs private.
</Note>

### Read-only URL option (staging)

The staging viewer also supports `readOnly=true`. It blocks browser controls
and page input while keeping connection and screencast Retry buttons usable:

```javascript theme={null}
const previewUrl = new URL(liveViewUrl);
previewUrl.searchParams.set("readOnly", "true");
previewUrl.searchParams.set("ui", "false"); // Optional: hide tabs and toolbar.
iframe.src = previewUrl.toString();
```

This option is not yet available on `live.browser-use.com`; use the iframe
wrapper above in production. It is a viewer URL option, not a field in the
browser or run creation request. Omitting it or setting it to `false` keeps
the viewer interactive, and `/session/{id}` links preserve it when redirecting.
Like the wrapper, it prevents UI input without changing CDP access permissions.

## Recording

Enable recording when the run creates its browser:

<CodeGroup>
  ```python Python theme={null}
  run = client.runs.create(
      "Test the checkout flow",
      browser_settings={"record": True},
  )
  ```

  ```typescript TypeScript theme={null}
  const run = await client.runs.create({
    task: "Test the checkout flow",
    model: "grok-4.5",
    browserSettings: { proxyCountryCode: "us", record: true },
  });
  ```

  ```bash curl theme={null}
  curl https://api.browser-use.com/api/v4/runs \
    -H "X-Browser-Use-API-Key: $BROWSER_USE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"task":"Test checkout","browserSettings":{"record":true}}'
  ```
</CodeGroup>

The MP4 becomes available in the Dashboard after the browser stops. After a run
completes, its browser can stay active for follow-ups; finishing the run alone
does not finalize the video. Once you no longer need the browser, stop it with
`PATCH /api/v4/browsers/{id}` and `{"action":"stop"}`, then allow time for upload
and processing.

API runs default to recording off. Zero Data Retention (ZDR) projects never
record, even if recording was requested; stopping the browser cannot produce
a recording when ZDR is active.

For standalone browsers, use `enableRecording: true` in
`POST /api/v4/browsers` (`enable_recording=True` in the Python SDK).
For agent-created browsers, use `browserSettings.record: true` as above.
These are different request shapes.

After stopping a standalone browser, poll `GET /api/v4/browsers/{id}` for
`recordingUrl`. The stop response and browser-list response do not contain a
ready recording URL. Stop polling when `recordingAvailable` is false; the
video cannot appear for that session. If the installed SDK does not expose
that field, use the REST response and the current API reference.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.