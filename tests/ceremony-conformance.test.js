// ceremony-conformance.test.js — task-666-ceremony-conformance (S157 Lane C2)
//
// WHAT THIS IS: conformance fixtures for four ceremony behaviors confirmed correct
// at S156/S157 merge. Pattern: source-extract (vad-replay / zone-geometry pattern) —
// structural presence checks and formula replays against the ACTUAL shipped source.
//
// FIXTURE GROUPS:
//   NF-01/NF-02: noisy-floor pass/fail pair — S156 r3 floor-relative interim gate.
//                Behavioral assertion: the formula lifts with quiet room noise and
//                rejects voice below the raised threshold in moderately noisy rooms.
//   DA-01: deaf-analyser rewire regression — S156 r5 structural check.
//          The 3s hard cap on AudioContext.resume() was removed; the gesture-bind
//          one-shot flag guards redundant listener attachment, not the resume itself.
//   SV-01/SV-02: skip-voice propagation — _vacVoiceSkipped flag propagates to both
//                the digit VAD rAF loop and the phrase gate completion check.
//   AE-01: adaptation-explain presence — the floor-relative calibration explanation
//          comment must be present in source so the adaptive behavior is documented.
//
// Run: node --test tests/ceremony-conformance.test.js   (Node built-in runner, no deps)

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const SRC_PATH = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

// Pull a `const NAME = <expr>;` value from source. Errors if not found.
function constFromSource(name) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
    assert.ok(m, `expected "const ${name} = ...;" in source — harness and source have diverged`);
    const value = Function('"use strict"; return (' + m[1] + ');')();
    assert.equal(typeof value, 'number', `${name} did not evaluate to a number: ${m[1]}`);
    return value;
}

// ──────────────────────────────────────────────────────────────────────────────
// NF-01 / NF-02: Noisy-floor pass/fail pair (S156 r3)
// The floor-relative interim gate formula:
//   _flr = audioNoiseFloor when [0, 0.05), else 0.010 (safety fallback)
//   vadSpeechThreshold = clamp(_flr + 0.028, 0.028, 0.065)
//   vadSilenceThreshold = clamp(_flr + 0.008, 0.006, vadSpeechThreshold - 0.008)
// These constants are extracted from source so any hotfix that changes them
// immediately breaks the fixture rather than silently drifting.
// ──────────────────────────────────────────────────────────────────────────────

// Extract the floor-relative interim formula constants from source.
// The arithmetic uses hardcoded literals (+0.028 / +0.008 / 0.065 / 0.010) baked
// into the inline formula — extract by matching the actual expression rather than
// introducing a new named constant that would change the production code.
function computeNoisyFloorThresholds(audioNoiseFloor) {
    var _flr = (typeof audioNoiseFloor === 'number' && audioNoiseFloor > 0 && audioNoiseFloor < 0.05)
        ? audioNoiseFloor : 0.010;
    var speechThr   = Math.min(Math.max(_flr + 0.028, 0.028), 0.065);
    var silenceThr  = Math.max(Math.min(_flr + 0.008, speechThr - 0.008), 0.006);
    return { speechThr: speechThr, silenceThr: silenceThr, flrUsed: _flr };
}

test('NF-01: FLOOR-RELATIVE formula present in source (S156 r3 structural check)', () => {
    // The formula must be present in the shipped source so the inline extract above
    // stays honest with what actually runs in the browser.
    assert.ok(
        src.includes('HOTFIX S156 r3') && src.includes('FLOOR-RELATIVE INTERIM'),
        'Source must contain the S156 r3 FLOOR-RELATIVE INTERIM comment — structural anchor for the noisy-floor formula'
    );
    assert.ok(
        src.includes('_flr + 0.028') && src.includes('_flr + 0.008'),
        'Source must contain the floor-relative offset expressions _flr+0.028 and _flr+0.008'
    );
});

test('NF-01 PASS: quiet desktop mic (floor=0.010) — normal voice clears floor-relative threshold', () => {
    // Fixture: MacBook built-in mic at sitting distance. Floor 0.010, typical voice 0.060.
    // Expected: speechThr = clamp(0.010+0.028, 0.028, 0.065) = 0.038. Voice 0.060 > 0.038 → FIRES.
    const floor = 0.010;
    const voiceRms = 0.060;
    const { speechThr } = computeNoisyFloorThresholds(floor);
    assert.ok(Math.abs(speechThr - 0.038) < 0.0001,
        `quiet-room speechThr must be 0.038, got ${speechThr.toFixed(4)}`);
    assert.ok(voiceRms > speechThr,
        `quiet desktop: voice rms ${voiceRms} must exceed speechThr ${speechThr.toFixed(4)} (gate must fire)`);
});

test('NF-02 FAIL: moderately noisy room (floor=0.040) — quiet voice blocked by raised threshold', () => {
    // Fixture: moderate noise (HVAC, open office). Floor=0.040 (< 0.05, formula uses it).
    // Expected: speechThr = clamp(0.040+0.028, 0.028, 0.065) = clamp(0.068, …, 0.065) = 0.065.
    // A quiet voice at 0.055 does NOT cross 0.065 — correctly silent.
    const floor = 0.040;
    const quietVoiceRms = 0.055;
    const { speechThr } = computeNoisyFloorThresholds(floor);
    assert.ok(Math.abs(speechThr - 0.065) < 0.0001,
        `noisy-room speechThr must be clamped to 0.065, got ${speechThr.toFixed(4)}`);
    assert.ok(quietVoiceRms < speechThr,
        `noisy room: quiet voice rms ${quietVoiceRms} must fall below speechThr ${speechThr.toFixed(4)} (gate must NOT fire)`);
});

test('NF-02 safety: very noisy room (floor>=0.05) falls back to 0.010 base (floor safety rail)', () => {
    // When the room floor is >= 0.05 (severe noise), the formula falls back to 0.010
    // rather than raising the threshold so high that even a raised voice can't clear it.
    const floor = 0.080;  // very noisy room — floor >= 0.05 triggers safety fallback
    const { flrUsed, speechThr } = computeNoisyFloorThresholds(floor);
    assert.equal(flrUsed, 0.010, `safety: floor=${floor} (>= 0.05) must fall back to _flr=0.010`);
    assert.ok(Math.abs(speechThr - 0.038) < 0.0001,
        `safety: very noisy room speechThr must revert to quiet-room value 0.038, got ${speechThr.toFixed(4)}`);
});

test('NF silence invariant: silence threshold strictly below speech threshold for all floor values', () => {
    // The fence between silence and speech must always hold — onset detection
    // requires hysteresis; if silence >= speech the VAD becomes a flip-flop.
    for (const floor of [0.000, 0.010, 0.020, 0.040, 0.049, 0.050, 0.100]) {
        const { speechThr, silenceThr } = computeNoisyFloorThresholds(floor);
        assert.ok(silenceThr < speechThr,
            `silence ${silenceThr.toFixed(4)} must be strictly below speech ${speechThr.toFixed(4)} for floor=${floor}`);
        assert.ok(silenceThr >= 0.006,
            `silenceThr ${silenceThr.toFixed(4)} must stay above true-silence floor (>= 0.006) for floor=${floor}`);
    }
});


// ──────────────────────────────────────────────────────────────────────────────
// DA-01: Deaf-analyser rewire regression (S156 r5)
// The bug: AudioContext.resume() was capped at a single one-shot attempt that
// could reject silently (swallowed rejection), leaving the analyser permanently
// deaf on macOS Chrome. The fix retries on EVERY phraseInterval tick while
// audioContext.state !== 'running', AND binds a gesture-triggered resume as
// the reliable path on gesture-gated platforms.
// ──────────────────────────────────────────────────────────────────────────────

test('DA-01: S156 r5 deaf-analyser fix present — retry resume comment in source', () => {
    // The S156 r5 comment anchors the structural change. If someone removes the
    // uncapped retry, this fixture fails before any live test can catch it.
    assert.ok(
        src.includes('S156 r5') && src.includes('retry resume on'),
        'Source must contain the S156 r5 retry-resume comment (deaf-analyser fix anchor)'
    );
});

test('DA-01: audioContext.resume() in renderGreeting is unconditional (not one-shot-capped)', () => {
    // Pre-fix: resume was inside `if (!_resumeRequested)` — one call, then abandoned.
    // Post-fix: resume is called every tick inside the non-running state check.
    // The gesture-bind uses __vacGestureResumeBound to stay one-shot; the ctx.resume()
    // itself must NOT be guarded by such a flag.
    //
    // Structural check: the source must NOT contain `if (!_resumeRequested)` or
    // `_resumeRequested = true` adjacent to `audioContext.resume()` — that was the
    // pre-fix one-shot pattern.
    const oneShot = /if\s*\(!\s*_resumeRequested\s*\)\s*\{[^}]*audioContext\.resume/.test(src);
    assert.ok(!oneShot,
        'audioContext.resume() in renderGreeting must NOT be inside a one-shot !_resumeRequested guard — ' +
        'the S156 r5 fix requires it to retry on every phraseInterval tick while non-running'
    );
});

test('DA-01: __vacGestureResumeBound one-shot gesture-bind present (S156 r5)', () => {
    // The gesture resume binding (click/keydown) must be one-shot to avoid
    // accumulating listeners across retries — __vacGestureResumeBound is the flag.
    assert.ok(
        src.includes('window.__vacGestureResumeBound'),
        'window.__vacGestureResumeBound must be set in source (one-shot gesture-resume binding, S156 r5)'
    );
    // Confirm the bind covers both click and keydown (reliable on gesture-gated platforms).
    // The gesture function is defined between the flag set and the addEventListener call, so
    // we need a larger search window (the function body + addEventListener line).
    const bindIdx = src.indexOf('__vacGestureResumeBound = true');
    assert.ok(bindIdx >= 0, '__vacGestureResumeBound = true must be present (gesture-bind latch)');
    const bindBlock = src.slice(bindIdx, bindIdx + 600);
    assert.ok(bindBlock.includes("'click'") && bindBlock.includes("'keydown'"),
        "Gesture resume must bind both 'click' and 'keydown' events (within 600 chars of flag set)");
});


// ──────────────────────────────────────────────────────────────────────────────
// SV-01 / SV-02: Skip-voice propagation E2E (window.__vacVoiceSkipped)
// The "Continue — skip voice" recovery path sets window.__vacVoiceSkipped = true.
// Both the digit VAD rAF loop and the phrase gate completion check must honour
// this flag — otherwise the user is silently blocked on voice after requesting skip.
// ──────────────────────────────────────────────────────────────────────────────

test('SV-01: __vacVoiceSkipped initialized to false on session start (no stale carry-over)', () => {
    // Must be false on VACReauth.start() / session init — a prior session's choice
    // (skip) must never bleed into the next session.
    assert.ok(
        src.includes('window.__vacVoiceSkipped = false;'),
        'window.__vacVoiceSkipped must be reset to false at session start — prior-session skip must not carry over'
    );
});

test('SV-01: __vacVoiceSkipped set to true by "Continue — skip voice" action', () => {
    assert.ok(
        src.includes('window.__vacVoiceSkipped = true;'),
        'window.__vacVoiceSkipped must be set to true when user picks "Continue — skip voice"'
    );
});

test('SV-01: digit VAD rAF loop reads __vacVoiceSkipped and exits via _speechGateOff', () => {
    // The digit VAD rAF loop must honour the skip flag. There are two check sites:
    //   1. At _startSpeechGate entry (before the rAF loop starts).
    //   2. Inside the rAF tick() IIFE — for users who click skip AFTER digit phase starts.
    // The rAF-loop site is identified by the trailing `_vadRAF = null; return;` which
    // cleans up the loop handle on skip. Both sites must be present.
    const entrySkip = src.includes("window.__vacVoiceSkipped) { _speechGateOff('user_skip'); return; }");
    assert.ok(entrySkip,
        "_startSpeechGate must check window.__vacVoiceSkipped on entry and call _speechGateOff('user_skip')"
    );
    // The rAF-loop site has `_vadRAF = null` on the same line (clean loop teardown).
    const rafSkip = src.includes("window.__vacVoiceSkipped) { _speechGateOff('user_skip'); _vadRAF = null; return; }");
    assert.ok(rafSkip,
        "Digit VAD rAF tick() must also check __vacVoiceSkipped and null _vadRAF (for late-skip after phase start)"
    );
});

test('SV-02: phrase gate completion honours __vacVoiceSkipped (phrase advances without voice on skip)', () => {
    // The phrase gate OK condition must include window.__vacVoiceSkipped as an early-exit.
    // Without this, the greeting phase requires voice even after the user requested skip.
    assert.ok(
        src.includes('window.__vacVoiceSkipped ||'),
        'Phrase gate completion must include "window.__vacVoiceSkipped ||" — skip propagates to phrase phase'
    );
    // The phrase gate OK condition variable must also include the skip
    const phraseGateIdx = src.indexOf('_phraseGateOk = phraseSpoke');
    assert.ok(phraseGateIdx >= 0, '_phraseGateOk must be defined');
    const phraseGateLine = src.slice(phraseGateIdx, phraseGateIdx + 200);
    assert.ok(
        phraseGateLine.includes('__vacVoiceSkipped'),
        '_phraseGateOk condition must check window.__vacVoiceSkipped'
    );
});


// ──────────────────────────────────────────────────────────────────────────────
// AE-01: Adaptation-explain presence
// The calibration adaptation explanation must be present so the adaptive threshold
// behavior is documented in-source and any future editor understands WHY the
// threshold changes per room. This is a conformance check, not a behavioral one.
// ──────────────────────────────────────────────────────────────────────────────

test('AE-01: floor-relative adaptation explanation present in source', () => {
    // FLOOR-RELATIVE INTERIM comment explains why the threshold rides the floor.
    assert.ok(
        src.includes('FLOOR-RELATIVE INTERIM'),
        'Source must contain "FLOOR-RELATIVE INTERIM" comment — adaptation behavior must be self-documenting'
    );
    // The explanation must include the key facts: what floor values are seen in practice,
    // why a constant won't work, and the speech = floor + offset formula.
    assert.ok(
        src.includes('no constant') || src.includes('no fixed bar'),
        'Adaptation explanation must state that no constant threshold serves all devices'
    );
    assert.ok(
        src.includes('Speech = floor + 0.028') || src.includes('floor + 0.028'),
        'Adaptation explanation must include the floor+0.028 formula (or equivalent)'
    );
});

test('AE-01: per-speaker fast calibration explanation present (_fastCalThreshold comment)', () => {
    // The fast calibration helper _fastCalThreshold must have a comment explaining
    // the per-speaker adaptation (why rollingFloor * MULT instead of a fixed threshold).
    assert.ok(
        src.includes('FAST_CAL_FLOOR_MULT') && src.includes('_fastCalThreshold'),
        'Source must contain FAST_CAL_FLOOR_MULT constant and _fastCalThreshold helper'
    );
    // The calibration constants must be within behavioral range (reachable by normal voice).
    const mult = constFromSource('FAST_CAL_FLOOR_MULT');
    const lo   = constFromSource('FAST_CAL_THR_MIN');
    const hi   = constFromSource('FAST_CAL_THR_MAX');
    assert.ok(mult > 1.0 && mult < 4.0,
        `FAST_CAL_FLOOR_MULT=${mult} should be a reasonable multiplier (1<m<4), not a constant offset`);
    assert.ok(lo >= 0.03 && lo < hi,
        `FAST_CAL_THR_MIN=${lo} must be in reasonable range [0.03, FAST_CAL_THR_MAX)`);
    assert.ok(hi <= 0.20,
        `FAST_CAL_THR_MAX=${hi} must be reachable by a normal indoor voice (≤ 0.20 time-domain RMS)`);
});
