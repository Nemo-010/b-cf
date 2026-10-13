/**
 * Solver registry.
 *
 * A "solver" here is the cheap, deterministic part of getting past a gate:
 * answering something the page asked, using a model that runs in the Worker.
 * It is NOT an evasion layer. The browser still has to be able to reach the
 * gate, and if the transport is already flagged, no answer helps.
 *
 * Cost, measured from the published rates in RESEARCH.md:
 *   ocr   Workers AI vision, ~a few hundred tokens per image
 *   audio Workers AI Whisper, 46.63 neurons per audio-minute (~$0.0005/min)
 */

import { solveImage } from './ocr.js';
import { solveAudio } from './audio.js';
import { inspectTurnstile, waitForWidget } from './turnstile.js';

export const SOLVERS = { solveImage, solveAudio, inspectTurnstile, waitForWidget };

/**
 * Dispatch a plan step from detect.solverPlan().
 *
 * @param {string} step  e.g. 'browser:audio', 'browser:wait-widget', 'human:handoff'
 * @param {{page?:any, env:any, challenge?:string, limits?:object}} ctx
 */
export async function runSolverStep(step, ctx) {
  const started = Date.now();
  try {
    switch (step) {
      case 'browser:audio': {
        const answer = await solveAudioFromPage(ctx.page, ctx.env);
        return { step, ok: Boolean(answer), answer, ms: Date.now() - started };
      }
      case 'browser:wait-widget': {
        const params = await inspectTurnstile(ctx.page);
        const token = await waitForWidget(ctx.page, ctx.limits?.widgetMs ?? 25_000);
        return { step, ok: Boolean(token), token, params, ms: Date.now() - started };
      }
      case 'browser:challenge-js': {
        // The vendor's own script does the work; we only give it wall time.
        await ctx.page?.waitForTimeout?.(ctx.limits?.jsMs ?? 8_000);
        return { step, ok: true, ms: Date.now() - started };
      }
      case 'human:handoff':
        return { step, ok: false, reason: 'requires a human operator', ms: Date.now() - started };
      default:
        return { step, ok: false, reason: `unknown step ${step}`, ms: Date.now() - started };
    }
  } catch (err) {
    return { step, ok: false, reason: String(err?.message || err), ms: Date.now() - started };
  }
}

/**
 * Find an audio challenge inside a reCAPTCHA/hCaptcha frame, pull the clip,
 * transcribe it with Whisper, and type the answer back into the browser.
 */
async function solveAudioFromPage(page, env) {
  if (!page) return null;
  const clip = await findAudioClip(page);
  if (!clip) return null;
  const bytes = clip.bytes || (await (await fetch(clip.url)).arrayBuffer());
  const transcript = await solveAudio(env, bytes, clip.contentType);
  if (!transcript) return null;
  const normalized = transcript.replace(/[^a-z0-9 ]/gi, '').trim();
  await typeAnswer(page, normalized);
  return normalized;
}

async function findAudioClip(page) {
  // reCAPTCHA v2 exposes the audio challenge at
  //   https://www.google.com/recaptcha/api2/payload?c=<token>&k=<sitekey>
  // after the audio button is activated. hCaptcha exposes an
  //   https://audio.hcaptcha.com/... clip after the audio option is chosen.
  const frames = page.frames?.() || [];
  for (const frame of frames) {
    const url = frame.url?.() || '';
    if (/recaptcha\/api2\/(anchor|bframe)/.test(url) || /hcaptcha/.test(url)) {
      const link = await frame.evaluate?.(() => {
        const a = document.querySelector('a[href*="payload"]') || document.querySelector('audio source');
        return a?.href || a?.src || null;
      });
      if (link) return { url: link, contentType: 'audio/mpeg' };
    }
  }
  return null;
}

async function typeAnswer(page, answer) {
  const frames = page.frames?.() || [];
  for (const frame of frames) {
    const url = frame.url?.() || '';
    if (!/recaptcha\/api2\/bframe|hcaptcha/.test(url)) continue;
    const input = await frame.$?.('#audio-response, textarea[name="audio-response"], input[type="text"]');
    if (input) {
      await input.type(answer, { delay: 30 });
      const button = await frame.$?.('#recaptcha-verify-button, button[type="submit"]');
      if (button) await button.click();
      return true;
    }
  }
  return false;
}
