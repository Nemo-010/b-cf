/**
 * Image-challenge solver: Workers AI vision model -> the characters in the image.
 *
 * Scope: classic distorted-text captchas, "what is 4 + 7" arithmetic gates, and
 * simple image grids. It is deliberately not a general visual reasoner.
 *
 * Cost: moondream3.1-9B is 27,273 neurons / 1M input tokens = $0.30 / 1M input
 * tokens at $0.011 / 1k neurons. A 400x120 captcha is a few hundred tokens, so
 * roughly $0.0001 per solve at worst. Whisper-audio solves are cheaper.
 */

export const DEFAULT_VISION_MODEL = '@cf/moondream/moondream3.1-9B-A2B';

const PROMPT =
  'This is a CAPTCHA challenge image. Reply with ONLY the characters or digits ' +
  'shown, no spaces, no punctuation, no explanation. If it is an arithmetic ' +
  'question, reply with only the numeric answer.';

/**
 * @param {any} env  must expose env.AI (Workers AI binding)
 * @param {ArrayBuffer|Uint8Array} bytes image bytes (png/jpeg/webp)
 * @param {{model?:string, prompt?:string}} [opts]
 * @returns {Promise<string|null>} normalised answer
 */
export async function solveImage(env, bytes, opts = {}) {
  if (!env?.AI?.run) throw new Error('solveImage needs the Workers AI binding (env.AI)');
  const model = opts.model || DEFAULT_VISION_MODEL;
  const image = toByteArray(bytes);

  const out = await env.AI.run(model, {
    image,
    prompt: opts.prompt || PROMPT,
    max_tokens: 32,
  });

  return normalize(out?.response ?? out?.description ?? out?.text ?? '');
}

/** moondream returns JSON for some tasks; accept either shape. */
function normalize(raw) {
  if (typeof raw !== 'string') {
    if (raw && typeof raw === 'object') raw = raw.text || raw.response || JSON.stringify(raw);
    else return null;
  }
  const cleaned = raw
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\b(answer|result|the characters? (are|is))\b[:\s]*/gi, '')
    .trim();
  if (!cleaned) return null;
  // Keep the shape a form field would accept.
  const compact = cleaned.replace(/\s+/g, '');
  return compact.length <= 12 ? compact : cleaned.slice(0, 32);
}

function toByteArray(bytes) {
  if (bytes instanceof Uint8Array) return Array.from(bytes);
  return Array.from(new Uint8Array(bytes));
}
