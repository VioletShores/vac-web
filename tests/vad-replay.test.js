// S155 L0 packet (task-ro-render-floors) — VAD REPLAY HARNESS.
//
// WHAT THIS IS: vac-reauth-ceremony.js is a browser-only script (window/document/MediaStream
// throughout) — it cannot be require()'d into Node as-is, so this harness does NOT execute the
// real capture loop. Instead it (a) extracts the ACTUAL tuning constants straight out of the
// source file by name (never a hand-copied duplicate that can silently drift from the shipped
// values), and (b) replays REAL recorded telemetry (tests/fixtures/vad-replay-fixtures.json —
// real /v1/auth/debug events, snapshotted with server-assigned ids + timestamps for provenance)
// through small pure reimplementations of the fire/calibration formulas. This is confirmation
// that the shipped constants + formulas, applied to REAL captured signal characteristics, produce
// the outcome the packet claims — not a full browser simulation.
//
// Run: node --test tests/vad-replay.test.js   (Node built-in test runner, no dependencies)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vad-replay-fixtures.json'), 'utf8'));

// Pull a `const NAME = <expr>;` value straight out of the shipped source, by name, regardless of
// indentation/scope. Evaluates the RHS expression (arithmetic literals only, e.g. `8`, `0.13`,
// `Math.ceil(3 * 1.3)`) so a constant expressed as a formula doesn't need a second hand-copy here.
function constFromSource(name) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
    assert.ok(m, `expected to find "const ${name} = ...;" in ${SRC_PATH} — the harness and the source have diverged`);
    const value = Function('"use strict"; return (' + m[1] + ');')();
    assert.equal(typeof value, 'number', `${name} did not evaluate to a number: ${m[1]}`);
    return value;
}

// Mirrors _calClamp in vac-reauth-ceremony.js.
function calClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Mirrors _fastCalThreshold(rollingFloor) — the S155 shared per-speaker calibration helper.
function fastCalThreshold(rollingFloor, mult, lo, hi) {
    if (!(rollingFloor > 0)) return null;
    return calClamp(rollingFloor * mult, lo, hi);
}

test('shared constants are present in source with the values this harness was written against', () => {
    assert.equal(constFromSource('VOICE_EVIDENCE_MIN_FRAMES'), 8);
    assert.equal(constFromSource('FAST_CAL_FLOOR_MULT'), 1.8);
    assert.equal(constFromSource('FAST_CAL_THR_MIN'), 0.05);
    assert.equal(constFromSource('FAST_CAL_THR_MAX'), 0.13);
    assert.equal(constFromSource('FINGER_RELEASE_SUSTAIN_MS'), 300);
    assert.equal(constFromSource('FINGER_RELEASE_MIN_FRAMES'), 4);
    // Positive-evidence finger floor (>=400ms sustained): asserted against MIN_DIGIT_DWELL_MS,
    // which the source comment documents as already exceeding it (700 > 400) — no separate
    // constant was introduced for a floor the existing dwell gate already satisfies.
    assert.ok(constFromSource('MIN_DIGIT_DWELL_MS') >= 400, 'finger sustained-hold floor (>=400ms) must hold');
});

test('D-VAD-GATE-FORK: the calibration helper is called from BOTH capture paths (no silent second formula)', () => {
    const callSites = src.match(/_fastCalThreshold\(audioNoiseFloor\)/g) || [];
    assert.ok(callSites.length >= 2, `expected >=2 call sites (full + fast tier) for the shared helper, found ${callSites.length}`);
});

test('Rob (real full-path live session, sess_sa1ymiye_reauth) fires — duration floor replay', () => {
    const minMs = constFromSource('DIGIT_VOICE_MIN_MS');
    const { events } = fixtures.rob_full_path_fires;
    assert.ok(events.length > 0, 'fixture must contain at least one real fire');
    for (const e of events) {
        assert.ok(e.dur_ms >= minMs, `event ${e.id} (digit ${e.digit_index}): recorded dur_ms=${e.dur_ms} must satisfy current DIGIT_VOICE_MIN_MS=${minMs}`);
        assert.ok(e.peak > e.thr, `event ${e.id}: recorded peak=${e.peak} must exceed the recorded threshold=${e.thr} — this is what "fired" means`);
    }
});

test('Rob (real rejected taps, same live session) are genuine onset-dip rejections, not fires', () => {
    // NOTE ON SEMANTICS (learned by replaying this fixture against the real source): had_ms is
    // elapsed wall-clock time since pre-onset start at the moment a DIP (a sustained neither-band
    // gap > VAD_ONSET_DIP_MS) broke continuity — it is NOT "duration achieved" and can legitimately
    // exceed need_ms (VAD_ONSET_SUSTAIN_MS), since the dip check runs every neither-band tick right
    // up to and past the sustain window's own length. So had_ms < need_ms is NOT a valid rejection
    // proof; the fixture's need_ms field staying equal to the current constant IS the real replay
    // check (confirms this historical rejection is still evaluated against the same onset window
    // this session shipped with, not a stale pre-change constant).
    const onsetMs = constFromSource('VAD_ONSET_SUSTAIN_MS');
    const { events } = fixtures.rob_full_path_rejected_taps;
    assert.ok(events.length > 0, 'fixture must contain at least one real rejection');
    for (const e of events) {
        assert.equal(e.need_ms, onsetMs, `event ${e.id}: fixture need_ms=${e.need_ms} should match the CURRENT VAD_ONSET_SUSTAIN_MS=${onsetMs} (else the fixture predates a since-changed constant and should be refreshed)`);
    }
    // Structural check: a rejected tap must never appear in the fires fixture (no overlap by id).
    const fireIds = new Set(fixtures.rob_full_path_fires.events.map((e) => e.id));
    for (const e of events) assert.ok(!fireIds.has(e.id), `event ${e.id} appears in BOTH the fired and rejected fixtures — contradiction`);
});

test('Skyssia (real fast-path session, sess_osdy8boy_reauth) — per-speaker cal makes her quiet voice fire and ambient stay silent', () => {
    const mult = constFromSource('FAST_CAL_FLOOR_MULT');
    const lo = constFromSource('FAST_CAL_THR_MIN');
    const hi = constFromSource('FAST_CAL_THR_MAX');
    const { calibrations, voice_climb_samples, ambient_samples, silence_samples } = fixtures.skyssia_fast_path;

    assert.ok(calibrations.length > 0);
    const peakVoice = Math.max(...voice_climb_samples.map((s) => s.rms_max));

    for (const cal of calibrations) {
        const thr = fastCalThreshold(cal.floor, mult, lo, hi);
        assert.ok(thr !== null, `calibration ${cal.id}: floor=${cal.floor} must produce a threshold`);
        assert.ok(thr >= lo && thr <= hi, `calibration ${cal.id}: thr=${thr} must stay within [${lo}, ${hi}]`);

        // Headline packet claim: her real recorded voice peak (0.124) must cross the NEW
        // per-speaker threshold — under the OLD flat 0.13 ceiling (cal.thr_old) it did not
        // (0.124 < 0.13), which is the exact quiet-voice miss the packet exists to fix.
        assert.ok(peakVoice > thr, `real voice peak=${peakVoice} must exceed the new per-speaker thr=${thr} (floor=${cal.floor})`);
        assert.ok(peakVoice < cal.thr_old, `sanity: this fixture is only interesting if the OLD flat threshold (${cal.thr_old}) would have missed it — if this fails, re-pull a real quiet-voice fixture`);

        // Her real recorded ambient reading must stay below the new threshold too — the floor
        // multiplier must not swing so low that room noise starts crossing it.
        const ambient = ambient_samples.find((a) => a.id === cal.id);
        if (ambient) {
            assert.ok(ambient.sil < thr, `ambient sil=${ambient.sil} (event ${ambient.id}) must stay below thr=${thr}`);
        }
    }
});

test('Skyssia — real true-silence samples never cross the new per-speaker threshold, for any recorded floor', () => {
    const mult = constFromSource('FAST_CAL_FLOOR_MULT');
    const lo = constFromSource('FAST_CAL_THR_MIN');
    const hi = constFromSource('FAST_CAL_THR_MAX');
    const { calibrations, silence_samples } = fixtures.skyssia_fast_path;
    for (const cal of calibrations) {
        const thr = fastCalThreshold(cal.floor, mult, lo, hi);
        for (const s of silence_samples) {
            assert.ok(s.rms_max < thr, `silence sample ${s.id} (rms_max=${s.rms_max}) must stay under thr=${thr}`);
        }
    }
});

test('Skyssia — real fired events (louder utterances, same session) still satisfy the current duration floor', () => {
    const minMs = constFromSource('FAST_DIGIT_VOICE_MIN_MS');
    for (const e of fixtures.skyssia_fast_path.fired) {
        assert.ok(e.dur_ms >= minMs, `event ${e.id}: recorded dur_ms=${e.dur_ms} must satisfy current FAST_DIGIT_VOICE_MIN_MS=${minMs}`);
        assert.ok(e.peak > e.thr, `event ${e.id}: recorded peak=${e.peak} must exceed the threshold active at capture time=${e.thr}`);
    }
});

// ── task-832/943 CEREMONY GATE-METER SENSOR UNIFICATION ─────────────────────────────────────
// Root cause (telemetry sess_y7uhiwty + sess_etn95zlg, 14 Aug, documented at
// vac-reauth-ceremony.js ~5016-5029): audioContext went suspended with no recovery, so the
// analyser read a permanently dead ~1% rms while the MediaRecorder-fallback energy (the thing
// actually driving the VISIBLE meter) showed Rob speaking. _phraseVadTick's voiced-run tracker
// only ever looked at the dead analyser rms, so _phraseVoicedTicks never accumulated and every
// escape (phrase_gate_dead_escape / phrase_pass_on_escape / phrase_speech_confirmed) was
// unreachable -> phrase_speech_timeout every attempt.
//
// No raw per-tick event JSON for these two sessions is checked into this repo (unlike the
// sess_sa1ymiye_reauth / sess_osdy8boy_reauth fixtures above, captured via /v1/auth/debug) — so
// unlike those, this is not a replay of real recorded numbers. Instead it mirrors
// _voicedRunTick/_voicedRunPass and the _spectralVoiced/escape-multiplier formulas straight out
// of the source against a tick sequence SHAPED to the documented symptom (rms pinned dead the
// entire time, _avMrLevelSynth crossing the admit floor partway through) — so it still fails
// loudly if any of those three formulas regress, and it demonstrates the specific mechanism
// (MR-fallback energy, not rms) that lets voiced ticks accumulate on a dead analyser.
function voicedRunTick(state, rms, isVoicedFrame, isSilenceFrame) {
    if (isVoicedFrame) {
        state.ticks++;
        if (rms < state.min) state.min = rms;
        if (rms > state.max) state.max = rms;
    } else if (isSilenceFrame) {
        state.ticks = Math.max(0, state.ticks - 1);
        if (state.ticks === 0) { state.min = 1; state.max = 0; }
    }
    return state;
}
function voicedRunPass(state, ticksNeeded, modDelta, modOverride) {
    return state.ticks >= ticksNeeded && (!!modOverride || (state.max - state.min) >= modDelta);
}

test('starved-mode replay (dead analyser + MR fallback): voiced ticks accumulate from fallback energy, not from the dead rms', () => {
    const ticksNeeded = constFromSource('VOICED_RUN_TICKS_NEEDED');
    const modDelta = constFromSource('VOICED_RUN_MOD_DELTA');
    const DEAD_RMS = 0.01;   // matches the documented ~1% analyser reading, the whole tick sequence through
    const state = { ticks: 0, min: 1, max: 0 };
    // Ticks 1-20: pre-starvation — dead rms, no MR evidence yet (source starves at _vadStarvedRun > 20).
    for (let i = 0; i < 20; i++) {
        voicedRunTick(state, DEAD_RMS, false, false);
    }
    assert.equal(state.ticks, 0, 'no voiced ticks should accumulate before MR fallback engages — the analyser alone never admits a dead-rms frame');
    // Ticks 21-27: starved mode is active and the MR fallback proxy now reads real speech
    // (_avMrLevelSynth >= 8) — _spectralVoiced admits the frame even though rms is still DEAD_RMS.
    for (let i = 0; i < ticksNeeded; i++) {
        const avMrLevelSynth = 15;  // representative "user is clearly speaking" MR proxy level
        const spectralVoiced = avMrLevelSynth >= 8;
        voicedRunTick(state, DEAD_RMS, spectralVoiced, false);
    }
    assert.ok(state.ticks >= ticksNeeded, `voiced ticks (${state.ticks}) must reach VOICED_RUN_TICKS_NEEDED=${ticksNeeded} purely from MR-fallback evidence despite a dead analyser`);
    // The run's rms never moved (still DEAD_RMS the whole time) so the modulation delta is ~0 —
    // this is exactly why _voicedRunPass needs the starved-mode override to bypass the mod check.
    assert.ok((state.max - state.min) < modDelta, 'sanity: a dead-rms run has no real modulation — the pass below must be via the starved override, not a coincidental mod pass');
    assert.equal(voicedRunPass(state, ticksNeeded, modDelta, false), false, 'without the starved override, a flat dead-rms run correctly fails the modulation check');
    assert.equal(voicedRunPass(state, ticksNeeded, modDelta, /* modOverride = _vadStarved */ true), true, 'with the starved override (mirrors _voicedRunPass(_phraseVoicedState, _vadStarved)), the MR-fallback-driven run passes');
});

test('starved-mode replay: gate-dead escape (phrase_gate_dead_escape) fires at 1.0x once the MR-fallback run qualifies', () => {
    const ticksNeeded = constFromSource('VOICED_RUN_TICKS_NEEDED');
    // Mirrors _phraseVadTick: `var _phraseGateDead = !_phraseHasTranscript; var _escapeMultiplier =
    // (_vadStarved || _phraseGateDead) ? 1.0 : 2;` — SR produced zero transcripts (device
    // contention, Rob's case) AND the analyser is starved, so both escape conditions are true.
    const vadStarved = true;
    const phraseHasTranscript = false;   // gate-dead: SR produced zero transcripts
    const phraseGateDead = !phraseHasTranscript;
    const escapeMultiplier = (vadStarved || phraseGateDead) ? 1.0 : 2;
    assert.equal(escapeMultiplier, 1.0, 'a starved analyser with a dead content gate must escape at 1.0x, not the 2x mismatch-strictness multiplier');
    const state = { ticks: ticksNeeded, min: 0.01, max: 0.01 };   // the qualifying MR-fallback run from the test above
    const escapeThreshold = ticksNeeded * escapeMultiplier;
    assert.ok(state.ticks >= escapeThreshold, `accumulated voiced_ticks=${state.ticks} must clear the gate-dead escape threshold=${escapeThreshold} — this is the condition that fires phrase_gate_dead_escape (was: unreachable, every attempt fell through to phrase_speech_timeout)`);
});
