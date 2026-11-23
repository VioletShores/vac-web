// face-stage-countdown.test.js — the Vault face check's countdown is its own visual block.
//
// Owner feedback, 23 Nov 2026: after starting the face check the 3-2-1 was hard to see, sitting in the
// same font and size as the wording beside it. This is presentation only. The gate that decides when the
// face stage is complete is byte-identical (fingerprinted below), the runner still ticks every 250 ms and
// resolves after exactly as many ticks as before, and a broken countdown block can never stop it.
//
// Run: node --test tests/face-stage-countdown.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const src = fs.readFileSync(path.join(__dirname, '..', 'vac-reauth-ceremony.js'), 'utf8');
const GATE_SHA256 = '45c61dac8c676f4de9fd4286bdb01e36630749107936320f7819603e74c5a4e9'; // at vac-web main 9dee3ac

function slice(from, to) { const a = src.indexOf(from); const b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a, b); }

function runner({ withBlock = true, brokenBlock = false } = {}) {
  let now = 0, nextTimer = 0, hand = -1;
  const timers = new Map(), listeners = {}, seen = [];
  const mk = (extra = {}) => Object.assign({ textContent: '', style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; } }, extra);
  const num = mk(), cue = mk(), chip = mk(), ring = mk();
  const block = mk({ querySelector(sel) { if (brokenBlock) throw new Error('boom');
    return { '#vacFaceStageNum': num, '#vacFaceStageCue': cue, '#vacFaceStageChip': chip, '#vacFaceStageRing': ring }[sel] || null; } });
  const stage = { querySelector(sel) { return withBlock && sel === '#vacFaceStageCount' ? block : null; } };
  const ready = { disabled: false, focus() {}, addEventListener(k, v) { listeners[k] = v; }, removeEventListener(k) { delete listeners[k]; } };
  const hint = { textContent: '', parentNode: stage };
  const recorder = { state: 'recording' };
  const video = { paused: false, ended: false, readyState: 4, videoWidth: 640, videoHeight: 480, currentTime: 0 };
  const c = vm.createContext({ Promise, Error, Number, Math, String, window: {}, mediaRecorder: recorder,
    document: { getElementById(id) { return id === 'vacFaceStageReady' ? ready : hint; } }, performance: { now: () => now },
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    FingerDetector: { ready: true, failed: false, detect() { return hand; } },
    _FaceAnchorDetector: { ready: true, failed: false, detect() { return { cx: .5 }; } } });
  vm.runInContext(slice('function _createVaultFaceStageGate(', '// DIAGNOSTIC ONLY: mean/max luminance'), c);
  const promise = c._runVaultFaceStage(video, recorder);
  return { promise, hint, block, num, cue, chip, ring, seen, click() { listeners.click(); }, setHand(v) { hand = v; },
    step() { now += 250; video.currentTime = now / 1000; const fns = Array.from(timers.values()); timers.clear(); for (const fn of fns) fn();
      seen.push({ num: num.textContent, cue: cue.textContent, chip: chip.textContent, phase: block.attrs['data-phase'], hint: hint.textContent }); } };
}

async function stepsToComplete(h) {
  let done = false; h.promise.then(() => { done = true; });
  h.click();
  for (let i = 1; i <= 60; i++) { h.step(); await Promise.resolve(); await Promise.resolve(); if (done) return i; }
  return -1;
}

test('the gate that decides completion is byte-identical', () => {
  const gate = slice('function _createVaultFaceStageGate(', '\nfunction _runVaultFaceStage(');
  assert.equal(crypto.createHash('sha256').update(gate).digest('hex'), GATE_SHA256);
  assert.match(gate, /elapsed>=3200 && clearFrames>=4/);
  assert.match(gate, /now-startedAt >= 20000/);
});

test('the runner still ticks every 250 ms and the countdown adds no timer of its own', () => {
  const run = slice('\nfunction _runVaultFaceStage(', '\nfunction _vacFaceStagePaint(');
  assert.equal((run.match(/setTimeout\(/g) || []).length, 1);
  assert.match(run, /timer=setTimeout\(tick,250\);/);
  const paint = slice('\nfunction _vacFaceStagePaint(', '// DIAGNOSTIC ONLY: mean/max luminance');
  assert.doesNotMatch(paint, /setTimeout|setInterval|requestAnimationFrame|resolve\(|reject\(|settle\(|gate\.|FingerDetector|_FaceAnchorDetector|mediaRecorder/);
});

test('the face stage takes exactly as many ticks with the countdown block as without it', async () => {
  const without = await stepsToComplete(runner({ withBlock: false }));
  const withIt = await stepsToComplete(runner({ withBlock: true }));
  const broken = await stepsToComplete(runner({ brokenBlock: true }));
  assert.ok(without > 0);
  assert.equal(withIt, without, 'duration unchanged');
  assert.equal(broken, without, 'a throwing countdown block cannot delay or stop the stage');
  assert.equal(without * 250, 3250, 'first complete tick after the 3200 ms hold, as before');
});

test('the countdown is its own block: 3, 2, 1 with a cue, then a distinct finished state', async () => {
  const h = runner();
  const n = await stepsToComplete(h);
  assert.ok(n > 0);
  const counting = h.seen.filter(s => s.phase === 'count');
  const nums = counting.map(s => s.num).filter((v, i, a) => i === 0 || a[i - 1] !== v);
  assert.deepEqual(nums, ['3', '2', '1']);
  assert.ok(counting.every(s => s.chip === 'Capturing'));
  assert.equal(counting[0].cue, 'Look at the camera');
  assert.equal(counting[counting.length - 1].cue, 'Hold still');
  const last = h.seen[h.seen.length - 1];
  assert.equal(last.phase, 'done');
  assert.equal(last.chip, 'All done');
  assert.equal(last.num, '✓');
  assert.equal(last.hint, 'Face captured. Checking your identity…', 'the status line is unchanged');
  assert.equal(h.ring.style.strokeDashoffset, '0');
});

test('before Ready, and when a hand comes back, the block does not show a number', async () => {
  const h = runner();
  h.step();
  assert.equal(h.seen[0].phase, 'idle');
  assert.equal(h.block.style.display, 'none');
  h.click(); h.step(); h.step();
  assert.equal(h.seen[h.seen.length - 1].phase, 'count');
  h.setHand(2); h.step();
  const paused = h.seen[h.seen.length - 1];
  assert.equal(paused.phase, 'paused');
  assert.equal(paused.num, '‖');
  assert.match(paused.hint, /hand is still visible/, 'the reason stays in the status line');
  h.setHand(-1); h.step();
  assert.equal(h.seen[h.seen.length - 1].phase, 'count');
  assert.equal(h.seen[h.seen.length - 1].num, '3', 'the hold restarts, as the gate already required');
});

test('the stage markup carries the block, hides it from screen readers, and respects reduced motion', () => {
  const show = slice('function _vacFaceStageShow() {', '\nfunction _vacFaceStageHide()');
  assert.match(show, /id="vacFaceStageCount"[^>]*aria-hidden="true"/, 'numbers are announced once, by the live status line');
  assert.match(show, /id="vacFaceStageHint" role="status" aria-live="polite"/);
  assert.match(show, /prefers-reduced-motion: ?reduce/);
  assert.match(show, /id="vacFaceStageNum"/);
  assert.doesNotMatch(show, /setTimeout|setInterval/, 'presentation never schedules a blind timer');
  assert.ok(show.indexOf('id="vacFaceStageCount"') < show.indexOf('id="vacFaceStageReady"'));
});
