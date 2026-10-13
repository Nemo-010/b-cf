#!/usr/bin/env node
/**
 * Verify (or regenerate) the browser profiles in
 * reference/src/lib/profiles.js against the Azathothas/b-ids corpus.
 *
 *   node tools/bids-profile.mjs             # check, exit 1 on drift
 *   node tools/bids-profile.mjs --print     # print the measured values
 *   node tools/bids-profile.mjs --emit      # write a fresh profiles block to stdout
 *
 * b-ids publishes a stable `latest` pointer per browser/channel/platform, so
 * this never hard-codes a version. If a capture lands upstream, this check
 * fails and the profile is meant to be updated, not silently left stale.
 */

const BASE = 'https://raw.githubusercontent.com/Azathothas/b-ids/data';
const CELLS = [
  { id: 'chrome-155-linux', browser: 'chrome', channel: 'stable', platform: 'linux64' },
  { id: 'chrome-155-win64', browser: 'chrome', channel: 'stable', platform: 'win64' },
];

const args = new Set(process.argv.slice(2));

async function get(path) {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.text()).trim();
}

async function measure(cell) {
  const stem = `${cell.browser}/${cell.channel}/latest/${cell.platform}`;
  // Read the `latest` pointer directly. Querying routes.json without pinning
  // `latest` picks whichever version sorts first and silently returns a stale
  // (and, for user-agent, a HeadlessChrome) measurement.
  const property = async (prop) => {
    try {
      return await get(`routes/${prop}/${stem}/navigate.txt`);
    } catch {
      return null;
    }
  };
  const [userAgent, secChUa, acceptLanguage] = await Promise.all([
    property('user-agent'),
    property('sec-ch-ua'),
    property('accept-language'),
  ]);
  let headerOrder = null;
  try {
    headerOrder = (await get(`routes/header-order/${stem}/navigate.list.txt`)).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    /* not every cell publishes a header order */
  }
  return { id: cell.id, userAgent, secChUa, acceptLanguage, headerOrder };
}

const results = [];
for (const cell of CELLS) results.push(await measure(cell));

if (args.has('--print') || args.size === 0) {
  for (const r of results) {
    console.log(`\n# ${r.id}`);
    console.log(`userAgent      = ${r.userAgent}`);
    console.log(`secChUa        = ${r.secChUa}`);
    console.log(`acceptLanguage = ${r.acceptLanguage}`);
    console.log(`headerOrder    = ${JSON.stringify(r.headerOrder)}`);
  }
}

if (args.has('--emit')) {
  console.log(JSON.stringify(results, null, 2));
}

if (args.size === 0) {
  const { PROFILES } = await import('../reference/src/lib/profiles.js');
  let drift = 0;
  for (const r of results) {
    const p = PROFILES[r.id];
    if (!p) {
      console.error(`MISSING profile ${r.id}`);
      drift++;
      continue;
    }
    for (const field of ['userAgent', 'secChUa', 'acceptLanguage']) {
      if (r[field] && p[field] !== r[field]) {
        console.error(`DRIFT ${r.id}.${field}\n  local:    ${p[field]}\n  upstream: ${r[field]}`);
        drift++;
      }
    }
    if (r.headerOrder && JSON.stringify(p.headerOrder) !== JSON.stringify(r.headerOrder)) {
      console.error(`DRIFT ${r.id}.headerOrder\n  local:    ${JSON.stringify(p.headerOrder)}\n  upstream: ${JSON.stringify(r.headerOrder)}`);
      drift++;
    }
  }
  console.log(drift === 0 ? '\nOK: profiles match the b-ids corpus' : `\n${drift} field(s) drifted`);
  process.exit(drift === 0 ? 0 : 1);
}
