'use strict';
// greeting-gate-margins.test.js — S166j (task-greeting-gate-margins-and-overlays, stamp s164j)
//
// TRACE THAT MOTIVATED THIS FILE (sess_lfh7beag_reauth, S166 Rob flight run, 22:37 UTC):
// the greeting gate hit phrase_speech_confirmed at rms 0.008 — genuine silence — because (a) the
// floor-relative admit (`_rms > audioNoiseFloor`) had no margin, (b) `_vbRatio` was trusted at ANY
// rms including near-zero (a ratio of noise-over-noise is not "voiced", it's undefined), and (c) a
// bare `|| _vadStarved` let ANY frame admit via band-ratio alone once the analyser was starved,
// regardless of actual amplitude. Fixed in _phraseVadTick (vac-reauth-ceremony.js ~L4962+).
//
// WHAT THIS IS: same pattern as tests/mic-voiced-run.test.js / tests/vad-replay.test.js — this
// file is a browser-only script (window/document/MediaStream throughout) and cannot be require()'d
// into Node, so this harness (a) source-anchors the fixed expressions so the mirror can't silently
// drift from shipped code, and (b) replays a hand-written mirror of the greeting admit predicate +
// shared _voicedRunTick/_voicedRunPass against the 'iphone_intermittent_greeting' fixture: voiced
// frames every-other-tick for ~2.8s (choppy iOS capture, real speech) then true silence at rms
// 0.008 for 6s WITH a high voice-band ratio (0.85-0.89) injected — the exact spectral shape from
// the production false-confirm trace — to prove the fix rejects it, not just a trivially-quiet tail.
//
// Run: node --test tests/greeting-gate-margins.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

function constFromSource(name) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
    assert.ok(m, `expected "const ${name} = ...;" in ${SRC_PATH} — mirror and source have diverged`);
    const value = Function('"use strict"; return (' + m[1] + ');')();
    assert.equal(typeof value, 'number', `${name} did not evaluate to a number: ${m[1]}`);
    return value;
}

// ── Source-anchor tests (items 1-3): the fixed expressions must be present verbatim ──────────

test('item 2 (BAND-RATIO GUARD): _vbRatio is forced to -1 (not meaningful) below rms 0.012', () => {
    assert.ok(
        src.includes("const _vbRatio = (_rms < 0.012) ? -1 : _voiceBandRatio(audioAnalyser, _buf);"),
        '_vbRatio guard missing or changed — a near-zero-energy frame can read a spurious high band ratio again'
    );
});

test('item 1 (ADMIT MARGIN): the floor-relative admit uses a margin, never bare audioNoiseFloor', () => {
    assert.ok(
        src.includes('var _phraseFloorAdmit = Math.max(audioNoiseFloor * 2, audioNoiseFloor + 0.01);'),
        '_phraseFloorAdmit margin expression missing or changed'
    );
    assert.ok(
        !/_rms\s*>\s*audioNoiseFloor(?!\s*\*)/.test(src.slice(src.indexOf('function _phraseVadTick'), src.indexOf('function _phraseVadTick') + 6000)),
        '_phraseVadTick must not compare _rms against bare audioNoiseFloor anywhere — always through the margin'
    );
});

test('item 3 (REMOVE bare vadStarved escape): the amplitude admit branch no longer has `|| _vadStarved`', () => {
    const idx = src.indexOf('const _voicedFrame = _spectralVoiced ||');
    assert.ok(idx !== -1, '_voicedFrame classifier not found — mirror is stale');
    const line = src.slice(idx, src.indexOf('\n', idx));
    assert.equal(
        line,
        'const _voicedFrame = _spectralVoiced || (_vbRatio >= VOICE_BAND_MIN_RATIO && (_rms > _phraseAmpThr || _rms > _phraseFloorAdmit));',
        '_voicedFrame classifier changed — expected the bare `|| _vadStarved` escape gone from the amplitude-OR-clause; starvation must admit only through _spectralVoiced'
    );
});

test('item 4 (GAP-TOLERANT RUN): _voicedRunTick decays by 1 on silence, does not hard-reset to 0', () => {
    // Already fixed by the S166 mictest-voiced-only merge (e1ea1c4) — guard against regressing it.
    assert.ok(
        src.includes('state.ticks = Math.max(0, state.ticks - 1);'),
        '_voicedRunTick must decay (-1, floor 0) on a silence frame, not hard-reset to 0'
    );
});

// ── Mirror of the shared _voicedRunTick/_voicedRunPass (identical to mic-voiced-run.test.js) ────

const VOICE_BAND_MIN_RATIO = constFromSource('VOICE_BAND_MIN_RATIO');
const VOICED_RUN_TICKS_NEEDED = constFromSource('VOICED_RUN_TICKS_NEEDED');
const VOICED_RUN_MOD_DELTA = constFromSource('VOICED_RUN_MOD_DELTA');
const VOICED_RUN_SILENCE_RMS_FLOOR = constFromSource('VOICED_RUN_SILENCE_RMS_FLOOR');   // = VAD_SILENCE_RMS_FALLBACK
const PHRASE_SILENCE_TICKS_NEEDED = 2;   // source: const PHRASE_SILENCE_TICKS_NEEDED = 2; (~400ms end-pause)
const BAND_RATIO_MIN_RMS = 0.012;        // source: (_rms < 0.012) ? -1 : ...
const STARVATION_RMS = 0.02;             // source: if (_rms < 0.02) { ...vadStarvedRun++... }
const STARVATION_TICKS = 20;             // source: ...vadStarvedRun > 20...

function newVoicedRunState() { return { ticks: 0, min: 1, max: 0 }; }
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
function voicedRunPass(state, modOverride) {
    return state.ticks >= VOICED_RUN_TICKS_NEEDED && (!!modOverride || (state.max - state.min) >= VOICED_RUN_MOD_DELTA);
}

// Mirror of the FIXED _phraseVadTick admit predicate (items 1-3).
function phraseAdmit(frame, audioNoiseFloor, phraseAmpThr, vadStarved, avMrLevelSynth) {
    const vbRatio = (frame.rms < BAND_RATIO_MIN_RMS) ? -1 : frame.vbRatioRaw;
    const spectralVoiced = vadStarved && ((avMrLevelSynth >= 8) || (frame.mb >= 2 && vbRatio >= VOICE_BAND_MIN_RATIO));
    const floorAdmit = Math.max(audioNoiseFloor * 2, audioNoiseFloor + 0.01);
    const voicedFrame = spectralVoiced || (vbRatio >= VOICE_BAND_MIN_RATIO && (frame.rms > phraseAmpThr || frame.rms > floorAdmit));
    const silenceFrame = frame.rms < VOICED_RUN_SILENCE_RMS_FLOOR;
    return { voicedFrame, silenceFrame, vbRatio, spectralVoiced };
}

// Mirror of the PRE-FIX admit predicate (what shipped before S166j) — used ONLY to prove the
// regression fixture actually reproduces the production bug against the OLD formula, so this
// isn't a tautological test of the new code against itself.
function phraseAdmitPreFix(frame, audioNoiseFloor, phraseAmpThr, vadStarved, avMrLevelSynth) {
    const vbRatio = frame.vbRatioRaw;   // no band-ratio guard
    const spectralVoiced = vadStarved && ((avMrLevelSynth >= 8) || (frame.mb >= 2 && vbRatio >= VOICE_BAND_MIN_RATIO));
    const voicedFrame = spectralVoiced || (vbRatio >= VOICE_BAND_MIN_RATIO && (frame.rms > phraseAmpThr || frame.rms > audioNoiseFloor || vadStarved));
    const silenceFrame = frame.rms < VOICED_RUN_SILENCE_RMS_FLOOR;
    return { voicedFrame, silenceFrame };
}

// ── Fixture: iphone_intermittent_greeting ────────────────────────────────────────────────────
// TICK_MS = 200 (source). Speech phase: alternating voiced/hold ticks (choppy iOS capture) until
// 7 voiced ticks accumulate (VOICED_RUN_TICKS_NEEDED) — reached at tick 12 (t=2.4s), inside the
// ~2.8s speech phase the task describes as "~2s". Then a genuine end-pause, then 6s of true
// silence at rms 0.008 carrying the ACTUAL bug trace's spectral shape (vbRatio 0.84-0.89) to prove
// the fix, not just a spectrally-quiet tail.
function buildIphoneIntermittentGreeting() {
    const frames = [];
    const SPEECH_TICKS = 14;   // ~2.8s: voiced at even indices, hold at odd
    for (let i = 0; i < SPEECH_TICKS; i++) {
        if (i % 2 === 0) {
            // voiced tick: rms cycles across the 0.04-0.15 band the task specifies; vbRatio strong.
            const rms = [0.06, 0.09, 0.12, 0.15, 0.08, 0.11, 0.14][i / 2];
            frames.push({ rms, vbRatioRaw: 0.80, mb: 40, phase: 'voiced' });
        } else {
            // intermittent gap: just above the true-silence floor (not a hard silence frame — a
            // formant dip / breath, the real-world case _voicedRunTick's decay-not-reset covers),
            // weak spectral shape so it doesn't ALSO admit via band ratio.
            frames.push({ rms: 0.032, vbRatioRaw: 0.10, mb: 5, phase: 'gap' });
        }
    }
    const SILENCE_TICKS = 30;   // 6s at TICK_MS=200
    for (let i = 0; i < SILENCE_TICKS; i++) {
        // the production trace: rms 0.006-0.008, vb 0.84-0.89 — genuine near-silence with a spurious
        // high band ratio (noise-over-noise). Alternates within the trace's observed range.
        const rms = (i % 2 === 0) ? 0.006 : 0.008;
        const vb = (i % 2 === 0) ? 0.84 : 0.89;
        frames.push({ rms, vbRatioRaw: vb, mb: 3, phase: 'silence_tail' });
    }
    return { name: 'iphone_intermittent_greeting', frames, speechTicks: SPEECH_TICKS };
}

// Full greeting-tick simulation: audioNoiseFloor seeded low (0.01, source default — no preflight
// adaptation), no MediaRecorder synthetic evidence (avMrLevelSynth stays 0 — this fixture has no
// real speech during the silence tail, so MR shouldn't have any either), starvation state tracked
// exactly as source does (rms<0.02 run > 20 ticks -> starved; rms>0.05 resets the run).
function runGreetingFixture(fixture, admitFn) {
    const audioNoiseFloor = 0.01;
    const phraseAmpThr = 0.055;   // VAD_SPEECH_RMS_FALLBACK fallback (no calibration in this fixture)
    const avMrLevelSynth = 0;
    let vadStarved = false, vadStarvedRun = 0;
    const state = newVoicedRunState();
    let phraseHeardVoice = false;
    let phraseSilenceTicks = 0;
    let heardAtTick = null, confirmedAtTick = null;
    const everVoicedDuringSilenceTail = [];

    fixture.frames.forEach((frame, i) => {
        if (frame.rms < STARVATION_RMS) { if (++vadStarvedRun > STARVATION_TICKS) vadStarved = true; }
        else if (frame.rms > 0.05) { vadStarvedRun = 0; }

        const { voicedFrame, silenceFrame } = admitFn(frame, audioNoiseFloor, phraseAmpThr, vadStarved, avMrLevelSynth);
        if (frame.phase === 'silence_tail') everVoicedDuringSilenceTail.push(voicedFrame);

        voicedRunTick(state, frame.rms, voicedFrame, silenceFrame && !phraseHeardVoice);

        if (voicedFrame) {
            phraseSilenceTicks = 0;
            if (voicedRunPass(state, vadStarved)) {
                if (!phraseHeardVoice && heardAtTick === null) heardAtTick = i;
                phraseHeardVoice = true;
            }
        } else if (silenceFrame) {
            if (phraseHeardVoice) {
                if (++phraseSilenceTicks >= PHRASE_SILENCE_TICKS_NEEDED && confirmedAtTick === null) {
                    confirmedAtTick = i;
                }
            }
        }
    });

    return { heardAtTick, confirmedAtTick, everVoicedDuringSilenceTail, finalTicks: state.ticks };
}

// ── The tests the task requires ──────────────────────────────────────────────────────────────

test('iphone_intermittent_greeting: FIXED predicate confirms during/immediately after the speech window', () => {
    const fixture = buildIphoneIntermittentGreeting();
    const result = runGreetingFixture(fixture, phraseAdmit);
    assert.ok(result.heardAtTick !== null, 'expected the voiced-run to pass during the speech window; it never did');
    assert.ok(
        result.heardAtTick < fixture.speechTicks,
        `expected the voiced-run pass at/before speech-window end (tick ${fixture.speechTicks}), got tick ${result.heardAtTick}`
    );
    assert.ok(result.confirmedAtTick !== null, 'expected phraseSpoke to confirm (a real end-pause after real speech)');
    assert.ok(
        result.confirmedAtTick <= fixture.speechTicks + PHRASE_SILENCE_TICKS_NEEDED + 1,
        `expected confirm right at the natural end-pause (~tick ${fixture.speechTicks}), got tick ${result.confirmedAtTick} — a late confirm means the silence tail is contributing false ticks`
    );
});

test('iphone_intermittent_greeting: FIXED predicate — the silence tail (rms 0.008, vb 0.84-0.89) is NEVER voiced', () => {
    const fixture = buildIphoneIntermittentGreeting();
    const result = runGreetingFixture(fixture, phraseAdmit);
    assert.ok(
        result.everVoicedDuringSilenceTail.every((v) => v === false),
        'FALSE CONFIRM ON SILENCE regression: the fixed predicate admitted a frame during the true-silence tail despite rms < 0.012 (band-ratio guard should force vbRatio=-1 there)'
    );
});

test('iphone_intermittent_greeting: PRE-FIX predicate reproduces the production bug (regression proof)', () => {
    // Proves the fixture actually exercises the bug: against the OLD formula (no band-ratio guard,
    // bare `|| _vadStarved` escape), the same silence-tail frames DO admit as voiced — matching the
    // sess_lfh7beag_reauth trace's phrase_speech_confirmed at rms=0.008.
    const fixture = buildIphoneIntermittentGreeting();
    const result = runGreetingFixture(fixture, phraseAdmitPreFix);
    assert.ok(
        result.everVoicedDuringSilenceTail.some((v) => v === true),
        'expected the PRE-FIX predicate to false-admit somewhere in the silence tail — if it does not, this fixture no longer reproduces the production bug and the "fixed" tests above are not proving anything'
    );
});

test('stamp: s167 present in source', () => {
    assert.ok(src.includes('s167'), 'vac-reauth-ceremony.js readout must contain pin s167');
});
