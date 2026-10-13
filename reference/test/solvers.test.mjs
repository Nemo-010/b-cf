import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveImage } from '../src/lib/solvers/ocr.js';
import { solveAudio } from '../src/lib/solvers/audio.js';
import { turnstileCapability } from '../src/lib/solvers/turnstile.js';
import { runSolverStep } from '../src/lib/solvers/index.js';

const aiEnv = (reply) => ({ AI: { run: async () => reply } });

test('image solver normalises a plain answer', async () => {
  assert.equal(await solveImage(aiEnv({ response: '  aB12c \n' }), new Uint8Array([1])), 'aB12c');
});

test('image solver strips conversational filler', async () => {
  assert.equal(await solveImage(aiEnv({ response: 'The characters are: 4F7K' }), new Uint8Array([1])), '4F7K');
});

test('image solver returns null when the model is empty', async () => {
  assert.equal(await solveImage(aiEnv({ response: '   ' }), new Uint8Array([1])), null);
});

test('audio solver expands spoken digits and keeps letters', async () => {
  assert.equal(await solveAudio(aiEnv({ text: 'A B one two' }), new Uint8Array([1])), 'ab12');
  assert.equal(await solveAudio(aiEnv({ text: 'seven four zulu nine' }), new Uint8Array([1])), '74zulu9');
});

test('audio solver rejects a too-short transcript', async () => {
  assert.equal(await solveAudio(aiEnv({ text: 'ok' }), new Uint8Array([1])), null);
});

test('turnstile capability reports the honest answer', () => {
  const c = turnstileCapability();
  assert.equal(c.pureRequestSolve, false);
  assert.equal(c.requiresTlsEmulation, true);
});

test('human handoff is reported as not solved rather than faked', async () => {
  const r = await runSolverStep('human:handoff', { env: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /human/);
});

test('unknown solver steps fail closed', async () => {
  const r = await runSolverStep('browser:teleport', { env: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unknown/);
});
