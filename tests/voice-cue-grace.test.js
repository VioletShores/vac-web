// voice-cue-grace.test.js — no "can't hear you" flash while a heard voice is still being checked.
//
// Owner feedback, 24 Nov 2026: for each digit the screen briefly said it had not caught the number,
// then about a second later showed ✓. Cause: voice ENERGY fires the moment you speak, but the number
// check answers ~1 s later, and the cue showed "did not catch" in that gap. That invited a repeat
// gesture, which causes lockouts. For a short grace the cue now reads a neutral "Listening…"; only an
// unmatched voice that outlasts it is coached. DISPLAY ONLY: the speech binding, the content gate and
// every server proof are byte-identical (fingerprinted below).
//
// Run: node --test tests/voice-cue-grace.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const src = fs.readFileSync(path.join(__dirname, '..', 'vac-reauth-ceremony.js'), 'utf8');
// sha256 of `function _refreshContentGate() {` .. `// neither band`: content gate, _markSpeech,
// per-digit voice evidence and the VAD fire block. Recorded at vac-web main 406754a.
const BINDING_SHA256 = '248a9768a5edf16a190ec710c060836f9690030e879b691f12263b5cec592177';

function slice(from, to) { const a = src.indexOf(from); const b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a, b); }
function load() {
  const c = vm.createContext({ Number });
  vm.runInContext(slice('const VOICE_CUE_GRACE_MS', '// F-561 per-digit cross-modal binding').replace('const VOICE_CUE_GRACE_MS', 'var VOICE_CUE_GRACE_MS'), c);
  return c;
}
const code = (s) => s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

test('the speech binding and content gate are byte-identical', () => {
  const region = slice('function _refreshContentGate() {', '// neither band');
  assert.equal(crypto.createHash('sha256').update(region).digest('hex'), BINDING_SHA256);
});

test('the cue helper: listening inside the grace, missed only after it, none once matched', () => {
  const c = load();
  assert.equal(c.VOICE_CUE_GRACE_MS, 2500);
  const f = c._vacVoiceCue, G = c.VOICE_CUE_GRACE_MS;
  assert.equal(f(false, false, 0, 1000, G), 'none');        // nothing heard yet
  assert.equal(f(true, false, 1000, 1000, G), 'listening'); // just heard
  assert.equal(f(true, false, 1000, 3499, G), 'listening'); // still inside the grace
  assert.equal(f(true, false, 1000, 3500, G), 'missed');    // grace over, still unmatched → honest coaching
  assert.equal(f(true, true, 1000, 9000, G), 'none');       // matched → ✓ path, no cue
  assert.equal(f(true, false, 0, 5000, G), 'listening');    // no timestamp yet → neutral, never "missed"
  assert.equal(f(true, false, NaN, 5000, G), 'listening');
});

test('a normal take (number check answers ~1 s after the voice) never shows "did not catch"', () => {
  const c = load(); const G = c.VOICE_CUE_GRACE_MS;
  const heardAt = 10000, matchedAt = 11100, states = [];
  for (let t = heardAt; t <= matchedAt + 500; t += 200) states.push(c._vacVoiceCue(true, t >= matchedAt, heardAt, t, G));
  assert.ok(!states.includes('missed'), states.join(','));
  assert.equal(states[0], 'listening');
  assert.equal(states[states.length - 1], 'none');
});

test('the tick wires the grace into every voice cue on screen (display only)', () => {
  const tick = code(slice('var inConfirmBeat = _now < _confirmUntil;', '// F-561/F-563: stuck-user escape'));
  assert.match(tick, /_vacVoiceCue\(_vadEnergyDetected, !!speechReady\[currentDigitIndex\], _voiceCueSinceAt, _now, VOICE_CUE_GRACE_MS\)/);
  assert.match(tick, /_voiceCueDigit !== currentDigitIndex/);          // per digit
  assert.match(tick, /_voiceCue === 'listening'\)\s*\?\s*\('Listening\\u2026 keep showing '/);
  assert.match(tick, /voiceListening: _voiceCue === 'listening'/);
  assert.match(tick, /energyHeard: _voiceCue === 'missed'/);
  assert.match(tick, /voiceHelp: _voiceCue !== 'listening' && /);
  assert.match(tick, /_coachKey = 'gestureonly'/);
  assert.match(tick, /!_coVoiceFired && _voiceCue !== 'listening'\)/);
  // The new state is written ONLY by its own display bookkeeping, and never feeds a gate.
  for (const line of src.split('\n')) {
    if (!/_voiceCue|VOICE_CUE_GRACE_MS|voiceListening/.test(line) || /^\s*\/\//.test(line)) continue;
    assert.doesNotMatch(line, /speechReady\[[^\]]*\]\s*=[^=]|_markSpeech\(|_acceptArmed\s*=[^=]|advance|fetch\(|_proof/i, line.trim());
  }
});

test('renderGuided says "Listening…" before the energy-heard coaching', () => {
  const rg = slice('if (opts.voiceListening && !opts.voiceDone)', "promptEl.style.color = 'var(--text-primary)';");
  const at = rg.indexOf("promptEl.textContent = 'Listening…';");
  assert.ok(at > 0);
  assert.ok(rg.indexOf('opts.energyHeard') > at);
  assert.match(src, /opts\.voiceListening \? 'keep showing it'/);
});
