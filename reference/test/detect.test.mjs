import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, solverPlan, CHALLENGE } from '../src/lib/detect.js';

const html = (body, status = 200, headers = { 'content-type': 'text/html; charset=utf-8' }) =>
  ({ status, headers, body, contentType: headers['content-type'] });

test('clean page is not a challenge and does not need rendering', () => {
  const v = classify(html('<html><body><h1>hello</h1>' + 'x'.repeat(5000) + '</body></html>'));
  assert.equal(v.challenge, CHALLENGE.NONE);
  assert.equal(v.needsRender, false);
  assert.equal(v.blocked, false);
});

test('Cloudflare "Just a moment" interstitial is a managed challenge', () => {
  const v = classify(html('<html><body><h1>Just a moment...</h1><script>window._cf_chl_opt={cType:"managed"}</script></body></html>', 403));
  assert.equal(v.challenge, CHALLENGE.CLOUDFLARE_MANAGED);
  assert.equal(v.confidence, 'high');
  assert.equal(v.blocked, true);
  assert.equal(v.needsRender, true);
});

test('Turnstile embedded in a content page is a widget, not a wall', () => {
  const page =
    '<html><body><article>' + 'word '.repeat(900) + '</article>' +
    '<div class="cf-turnstile" data-sitekey="0x4AAAAAAAA"></div>' +
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>';
  const v = classify(html(page));
  assert.equal(v.challenge, CHALLENGE.TURNSTILE);
  assert.equal(v.needsRender, false, 'a widget inside real content should not force a re-render');
});

test('a short Turnstile gate does force a render', () => {
  const v = classify(html('<html><body><div class="cf-turnstile" data-sitekey="0x4AAAAAAAA"></div></body></html>', 403));
  assert.equal(v.challenge, CHALLENGE.TURNSTILE);
  assert.equal(v.needsRender, true);
});

test('reCAPTCHA and hCaptcha are recognised', () => {
  assert.equal(classify(html('<div class="g-recaptcha" data-sitekey="k"></div>')).challenge, CHALLENGE.RECAPTCHA);
  assert.equal(classify(html('<script src="https://hcaptcha.com/1/api.js"></script>')).challenge, CHALLENGE.HCAPTCHA);
});

test('empty SPA root is flagged as needing render, not blocked', () => {
  const v = classify(html('<html><body><div id="root"></div><script type="module" src="/a.js"></script></body></html>'));
  assert.equal(v.challenge, CHALLENGE.JS_SHELL);
  assert.equal(v.needsRender, true);
  assert.equal(v.blocked, false);
});

test('binary content is never scanned for challenge markers', () => {
  const v = classify({ status: 200, headers: { 'content-type': 'image/png' }, body: '<html>', contentType: 'image/png' });
  assert.equal(v.challenge, null);
  assert.equal(v.needsRender, false);
});

test('solver plans never claim a pure-request Turnstile solve', () => {
  assert.deepEqual(solverPlan(CHALLENGE.TURNSTILE), ['browser:wait-widget', 'human:handoff']);
  assert.deepEqual(solverPlan(CHALLENGE.RECAPTCHA), ['browser:audio', 'human:handoff']);
  assert.deepEqual(solverPlan(CHALLENGE.JS_SHELL), ['render']);
  assert.deepEqual(solverPlan(CHALLENGE.NONE), []);
});
