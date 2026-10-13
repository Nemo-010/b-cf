#!/usr/bin/env python3
"""Cost model: what 1,000 fetched pages cost on each option.

Every rate is a published number with a source. Run:

    python3 tools/cost-model.py
    python3 tools/cost-model.py --pages 100000 --seconds 3 --mb 1.5

Rates captured 2026-10-13. Sources:
  CF Browser Run pricing  https://developers.cloudflare.com/browser-run/pricing/
  CF Workers pricing      https://developers.cloudflare.com/workers/platform/pricing/
  CF Workers AI pricing   https://developers.cloudflare.com/workers-ai/platform/pricing/
  Browser Use pricing     https://browser-use.com/pricing.md
  Jina Reader rate limits https://jina.ai/reader
  ThorData / IPRoyal      https://thordata.com/pricing , https://iproyal.com/pricing/residential-proxies/
"""

import argparse

# --- published rates (USD) ---------------------------------------------------
WORKERS_PAID_MIN = 5.00          # per month, minimum charge
WORKERS_REQ_INCLUDED = 10_000_000
WORKERS_REQ_OVERAGE = 0.30       # per million
WORKERS_CPU_INCLUDED_MS = 30_000_000
WORKERS_CPU_OVERAGE = 0.02       # per million CPU-ms

BROWSER_FREE_HOURS = 10.0        # included per month on Workers Paid
BROWSER_HOUR_OVERAGE = 0.09      # per browser-hour
BROWSER_CONCURRENT_INCLUDED = 10
BROWSER_CONCURRENT_OVERAGE = 2.00  # per extra concurrent browser, monthly average
BROWSER_FREE_DAILY_MINUTES = 10  # Workers Free plan

WORKERS_AI_PER_1K_NEURONS = 0.011
WHISPER_NEURONS_PER_AUDIO_MIN = 46.63      # @cf/openai/whisper-large-v3-turbo
MOONDREAM_IN_NEURONS_PER_MTOK = 27_273     # @cf/moondream/moondream3.1-9B-A2B

BROWSER_USE_HOUR = 0.02
BROWSER_USE_RESIDENTIAL_GB = 5.00
BROWSER_USE_DIRECT_GB = 0.20

RESIDENTIAL_GB_BULK = 0.65       # ThorData bulk tier
RESIDENTIAL_GB_RETAIL = 1.75     # IPRoyal bulk tier
VPS_MONTH = 5.00                 # a small always-on box


def per_1000(pages, seconds_per_page, mb_per_page, hourly, gb=None, floor_hours=None):
    hours = pages * seconds_per_page / 3600.0
    if floor_hours is not None:
        hours = max(hours, floor_hours)
    cost = hours * hourly
    if gb is not None:
        cost += pages * mb_per_page / 1024.0 * gb
    return cost, hours


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pages', type=int, default=1000)
    ap.add_argument('--seconds', type=float, default=2.0, help='browser seconds per page')
    ap.add_argument('--mb', type=float, default=1.5, help='MB of response body per page')
    ap.add_argument('--concurrent', type=int, default=1)
    args = ap.parse_args()

    n, s, mb = args.pages, args.seconds, args.mb
    print(f'workload: {n:,} pages x {s}s browser time x {mb} MB/page\n')

    rows = []

    # Workers + fetch only (no browser): the tier that handles most URLs
    rows.append(('Workers fetch only', 0.0, 'no browser hours; only Workers request/CPU overage above $5/mo'))

    # Browser Run Quick Actions / single reused session
    cost, hours = per_1000(n, s, mb, BROWSER_HOUR_OVERAGE)
    free_equiv = BROWSER_FREE_HOURS * 3600 / s
    rows.append((f'CF Browser Run (quick action)', cost,
                 f'{hours:.2f} browser-hours; {free_equiv:,.0f} pages/mo are inside the 10h free allowance'))

    # Browser Run with many concurrent sessions
    if args.concurrent > 1:
        extra = max(0, args.concurrent - BROWSER_CONCURRENT_INCLUDED)
        rows.append((f'CF Browser Run (+{extra} concurrent browsers)',
                     cost + extra * BROWSER_CONCURRENT_OVERAGE,
                     f'${BROWSER_CONCURRENT_OVERAGE}/extra concurrent browser, monthly average'))

    # Browser Use
    cost_bu, hours_bu = per_1000(n, s, mb, BROWSER_USE_HOUR, BROWSER_USE_RESIDENTIAL_GB)
    rows.append(('Browser Use + residential proxy', cost_bu,
                 f'{hours_bu:.2f} h x ${BROWSER_USE_HOUR}/h + {n*mb/1024:.2f} GB x ${BROWSER_USE_RESIDENTIAL_GB}/GB'))
    cost_bu_d, _ = per_1000(n, s, mb, BROWSER_USE_HOUR, BROWSER_USE_DIRECT_GB)
    rows.append(('Browser Use + direct/own proxy', cost_bu_d,
                 f'+ {n*mb/1024:.2f} GB x ${BROWSER_USE_DIRECT_GB}/GB'))

    # DIY: VPS + our own Chrome + bought residential proxy
    for label, gb in (('DIY: VPS + residential (bulk $0.65/GB)', RESIDENTIAL_GB_BULK),
                      ('DIY: VPS + residential (retail $1.75/GB)', RESIDENTIAL_GB_RETAIL)):
        bw = n * mb / 1024.0 * gb
        rows.append((label, VPS_MONTH * (n / 100_000.0) + bw,
                     f'${VPS_MONTH}/mo VPS amortised at 100k pages/mo (${VPS_MONTH*n/100_000:.2f} here) + {n*mb/1024:.2f} GB x ${gb}/GB'))

    # Jina Reader
    rows.append(('Jina Reader (r.jina.ai, no key)', 0.0, '20 RPM free; token-metered with an API key'))

    w = max(len(r[0]) for r in rows)
    print(f'{"option":<{w}}  {"USD / "+format(n,",")+" pages":>16}   notes')
    print('-' * (w + 60))
    for name, cost, note in rows:
        print(f'{name:<{w}}  {cost:>16.4f}   {note}')

    print('\nsolver costs (Workers AI, per 1,000 solves)')
    audio_min = 0.2
    print(f'  audio challenge via Whisper : {1000*audio_min*WHISPER_NEURONS_PER_AUDIO_MIN/1000*WORKERS_AI_PER_1K_NEURONS:.5f} USD'
          f'  ({audio_min*60:.0f}s clip)')
    img_tokens = 0.0004  # ~400 input tokens for a small captcha image
    print(f'  image captcha via moondream  : {1000*img_tokens*MOONDREAM_IN_NEURONS_PER_MTOK/1000*WORKERS_AI_PER_1K_NEURONS:.5f} USD'
          f'  (~400 input tokens)')


if __name__ == '__main__':
    main()
