/**
 * Audio-challenge solver: Workers AI Whisper -> text -> normalised answer.
 *
 * This is the fastest genuinely-serverless path that exists for the two big
 * widget vendors, because both ship an accessibility audio fallback and both
 * accept the answer as plain text. It costs ~$0.0005 per audio-minute, i.e.
 * a rounding error next to the browser time it saves.
 *
 * The browser still has to fetch the clip and type the answer: the token that
 * results is bound to the page session. See solvers/index.js.
 */

export const DEFAULT_ASR_MODEL = '@cf/openai/whisper-large-v3-turbo';

/**
 * @param {any} env  must expose env.AI
 * @param {ArrayBuffer|Uint8Array} bytes audio bytes (mp3/wav/ogg)
 * @param {string} [contentType]
 * @returns {Promise<string|null>} lowercased alphanumeric answer
 */
export async function solveAudio(env, bytes, contentType = 'audio/mpeg') {
  if (!env?.AI?.run) throw new Error('solveAudio needs the Workers AI binding (env.AI)');
  const audio = toByteArray(bytes);
  const out = await env.AI.run(DEFAULT_ASR_MODEL, { audio, contentType });
  return normalize(out?.text ?? out?.transcription ?? '');
}

/**
 * reCAPTCHA and hCaptcha both read a spoken sequence of letters/digits. Models
 * heard "A B one two" or "AB12", so collapse to the transcript then keep the
 * token characters only.
 */
export function normalize(raw) {
  if (!raw) return null;
  const spoken = String(raw)
    .toLowerCase()
    .replace(/\b(zero|oh)\b/g, '0')
    .replace(/\bone\b/g, '1')
    .replace(/\btwo|to\b/g, '2')
    .replace(/\bthree\b/g, '3')
    .replace(/\bfour|for\b/g, '4')
    .replace(/\bfive\b/g, '5')
    .replace(/\bsix\b/g, '6')
    .replace(/\bseven\b/g, '7')
    .replace(/\beight|ate\b/g, '8')
    .replace(/\bnine\b/g, '9');
  const compact = spoken.replace(/[^a-z0-9]/g, '');
  return compact.length >= 3 ? compact : null;
}

function toByteArray(bytes) {
  if (bytes instanceof Uint8Array) return Array.from(bytes);
  return Array.from(new Uint8Array(bytes));
}
