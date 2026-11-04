'use strict';
// Independent release-review guard. This file intentionally fails on the
// currently blocked f50d7e5 candidate. Claude's implementation must make
// the shipping ceremony source pass WITHOUT reducing biometric requirements.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'vac-reauth-ceremony.js'), 'utf8');

// Shipping JS is served as source; query params and referrer are controlled by
// the browser visitor, not by a trusted build or administrator.
test('VAC-PROD-QA-01: shipping ceremony cannot substitute a mock audio context', () => {
  assert.doesNotMatch(src, /window\\.__vacTshInjectAv/, 'production ceremony exposes a writable mock audio injection seam');
});

test('VAC-PROD-QA-02: production self-test always reads the real audio graph', () => {
  const start = src.indexOf('function _runSyntheticAudioSelfTest(cb)');
  const end = src.indexOf('window.__vacRunSyntheticAudioSelfTest', start);
  assert.ok(start >= 0 && end > start, 'synthetic audio self-test must remain present');
  const body = src.slice(start, end);
  assert.match(body, /avAudioCtx/, 'the real microphone audio context remains required');
  assert.match(body, /avAnalyser/, 'the real analyser remains required');
  assert.doesNotMatch(body, /_qaFlag|__vacTshInjectAv|_inj\b/, 'test-only injection must not be reachable from production self-test');
});

test('VAC-PROD-QA-03: no query/referrer-only mock microphone enablement', () => {
  const start = src.indexOf('function _runSyntheticAudioSelfTest(cb)');
  const end = src.indexOf('window.__vacRunSyntheticAudioSelfTest', start);
  const body = src.slice(start, end);
  assert.doesNotMatch(body, /document\.referrer|URLSearchParams|location\.search/, 'visitor-controlled URL/referrer cannot choose a mock self-test source');
});

// This guard does not claim real iPad biometric acceptance, liveness/identity
// binding, or full critical Vault store. Those remain separate release gates.
