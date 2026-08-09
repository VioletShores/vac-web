// greeting-audible.test.js — S158 ceremony self-testing: sensor 1
//
// Verifies that vac-reauth-ceremony.js emits the `greeting_audible` telemetry beacon
// at the point where the phrase phase advances to the digit phase.
//
// WHAT THIS GUARDS:
//   D-GREETING-ANALYSER-SILENT-ADVANCE: the ceremony advancing from the greeting
//   phase with no record of whether audio was ever received. With task-672's teardown,
//   a pagehide during the greeting leaves audioAnalyser null for the rest of the phase;
//   the PHRASE_PHASE_MAX_S timeout then fires silently. greeting_audible exposes this.
//
//   D-TEARDOWN-PLAYBACK-ORDER: mediaStream tracks stopped before MediaRecorder buffer
//   flushed — buffered audio frames discarded. Fixed in S158: recorder.stop() called
//   first. Verified below: the source has the correct guard expression.
//
// Pattern: source-extract (same as confirmed-behaviors.test.js / vad-replay.test.js).
//
// Run: node --test tests/greeting-audible.test.js

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const SRC_PATH = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

// ── CB-GREET-01: greeting_audible event is emitted ───────────────────────────
test('CB-GREET-01: greeting_audible vacDebug event is present in ceremony source', () => {
    assert.ok(
        src.includes("vacDebug('greeting_audible'"),
        "Expected vacDebug('greeting_audible', ...) in vac-reauth-ceremony.js — S158 sensor 1 missing"
    );
});

// ── CB-GREET-02: greeting_audible includes heard field ───────────────────────
test('CB-GREET-02: greeting_audible beacon includes "heard" field', () => {
    const m = src.match(/vacDebug\('greeting_audible'[^;]+heard\s*:/);
    assert.ok(m, 'greeting_audible must include a "heard" field (phraseSpoke result)');
});

// ── CB-GREET-03: greeting_audible includes analyser_frames field ──────────────
test('CB-GREET-03: greeting_audible beacon includes "analyser_frames" field', () => {
    const m = src.match(/vacDebug\('greeting_audible'[^;]+analyser_frames\s*:/);
    assert.ok(m, 'greeting_audible must include "analyser_frames" (self-audition health)');
});

// ── CB-GREET-04: _phraseAnalyserFrames counter is declared and incremented ───
test('CB-GREET-04: _phraseAnalyserFrames is declared and incremented in _phraseVadTick', () => {
    assert.ok(
        src.includes('_phraseAnalyserFrames = 0'),
        '_phraseAnalyserFrames must be initialised to 0 (self-audition frame counter)'
    );
    assert.ok(
        src.includes('_phraseAnalyserFrames++'),
        '_phraseAnalyserFrames must be incremented inside _phraseVadTick'
    );
});

// ── CB-GREET-05: teardown flushes MediaRecorder before stopping tracks ────────
test('CB-GREET-05 [D-TEARDOWN-PLAYBACK-ORDER regression]: recorder flushed before track stop in _teardownOnExit', () => {
    // The fix: mediaRecorder.stop() must appear BEFORE mediaStream.getTracks()...stop()
    // in _teardownOnExit so buffered audio frames are not discarded (S158 regression fix).
    const teardownIdx = src.indexOf('_teardownOnExit');
    assert.ok(teardownIdx !== -1, '_teardownOnExit must exist in source');

    const teardownBody = src.slice(teardownIdx, teardownIdx + 800);
    const recStopIdx  = teardownBody.indexOf('mediaRecorder');
    const trackStopIdx = teardownBody.indexOf('mediaStream');
    assert.ok(recStopIdx !== -1, 'mediaRecorder.stop() must be present in _teardownOnExit');
    assert.ok(trackStopIdx !== -1, 'mediaStream.getTracks() must be present in _teardownOnExit');
    assert.ok(
        recStopIdx < trackStopIdx,
        'mediaRecorder.stop() must come BEFORE mediaStream.getTracks().stop() in _teardownOnExit'
    );
});

// ── CB-GREET-06: pin is s158a1 in readout ────────────────────────────────────
test('CB-GREET-06: ceremony readout pin is s158a1', () => {
    assert.ok(
        src.includes('s158a1'),
        'vac-reauth-ceremony.js readout must contain pin s158a1'
    );
    assert.ok(
        !src.includes('s157c1'),
        'vac-reauth-ceremony.js must not contain old pin s157c1'
    );
});
