'use strict';
// ceremony-gate-harness.test.js — F-1139 S164 Ceremony Liveness Gate Harness (Node mirror tier)
//
// WHAT THIS FILE IS — AND ISN'T: this is the FAST, source-anchored MIRROR tier. It does not load
// or execute vac-reauth-ceremony.js at all — the gate decision functions below are hand-written
// reimplementations, cross-checked against source constants (constFromSource()) and literal source
// text (the "Gate pattern anchor:" tests). That is useful (catches constant/pattern drift on every
// push, in ~100ms, no browser) but it is NOT what satisfies the FOUNDING REQUIREMENT (L-511/L-676
// anti-trap: "the harness must drive the REAL shipping gate, not a reimplementation"). An earlier
// version of this file's header claimed it did; that was wrong and has been corrected — see
// F1139-HARNESS-DESIGN-S164.md's "Correction to an earlier draft" note.
//
// THE TIER THAT DOES SATISFY THE ANTI-TRAP REQUIREMENT is tests/ceremony-harness-fixtures.pw.js,
// which sets window.__vacTestAudioFill / window.__vacTestAvAudioFill (the injection seam these
// source-anchor tests verify exists) in a real Chromium page and drives the actual, unmodified
// _phraseVadTick / runAVFrame mic-qualify block through the ceremony's own timers. Run both tiers;
// treat this file's PASS as "the mirror is internally consistent and source hasn't drifted," and
// the .pw.js file's PASS as "the real gate does this."
//
// INJECTION SEAM (added to vac-reauth-ceremony.js, consumed by the .pw.js tier, verified to exist
// here by source-anchor tests):
//   window.__vacTestAudioFill(tdBuf, freqBuf)   — fills both audio buffers in _phraseVadTick
//   window.__vacTestAvAudioFill(tdBuf, freqBuf) — fills both audio buffers in runAVFrame mic-qualify
//   window.__vacSetMrLevel(n)                   — sets _avMrLevelSynth (starvation path test)
//   window.__vacSetVadStarved(bool)              — forces _vadStarved (starved-path simulation)
//
// SCOPE (Phase 1):
//   - Synthetic fixtures: 8 scenarios covering liveness, silence, noise, IOS_AMPLITUDE_CRUSH
//   - Phrase VAD gate simulation: mirrors _phraseVadTick from beginRecording()
//   - Mic-qualify gate simulation: mirrors runAVFrame qualifying block
//   - APCER/BPCER framing (methodologically-aligned, NOT certified — see design doc's VAC-PA-001 note)
//   - IOS_AMPLITUDE_CRUSH DOCUMENTED as FAIL → reproduces tonight's priority bug (mirror-level;
//     tests/ceremony-harness-fixtures.pw.js documents the same fixture against the real gate)
//
// Run: node --test tests/ceremony-gate-harness.test.js
// Real-gate tier: npx playwright test tests/ceremony-harness-fixtures.pw.js
// Design doc: docs/strategic/F1139-HARNESS-DESIGN-S164.md

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const { FIXTURES, MIC_FIXTURES, rmsOfTdBuf, vbRatioOfFreqBuf,
        FFT_SIZE, FREQ_BINS, VOICE_BAND_START, VOICE_BAND_END } = require('./fixtures/ceremony-audio-fixtures');

const SRC_PATH = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

// ── Source extractor (same pattern as vad-replay.test.js) ────────────────────
// Reads constants by name directly from the shipped source — if source drifts, test fails.
function constFromSource(name) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
    assert.ok(m, `Expected "const ${name} = ...;" in ${SRC_PATH} — harness and source have diverged`);
    const value = Function('"use strict"; return (' + m[1] + ');')();
    assert.ok(typeof value === 'number', `${name} did not evaluate to a number: ${m[1]}`);
    return value;
}

// ── Source-anchor tests: verify injection seam and gate patterns exist ────────

test('F-1139 injection seam: window.__vacTestAudioFill hook present in _phraseVadTick', () => {
    assert.ok(
        src.includes('typeof window.__vacTestAudioFill === \'function\''),
        'F-1139 injection seam missing — window.__vacTestAudioFill hook not found in vac-reauth-ceremony.js. ' +
        'Required for browser-side fixture injection into the REAL gate (L-511 anti-trap).'
    );
});

test('F-1139 injection seam: window.__vacTestAvAudioFill hook present in runAVFrame mic-qualify block', () => {
    assert.ok(
        src.includes('typeof window.__vacTestAvAudioFill === \'function\''),
        'F-1139 injection seam missing — window.__vacTestAvAudioFill hook not found in vac-reauth-ceremony.js. ' +
        'Required for browser-side fixture injection into the REAL AV preflight mic-qualify block (L-511 anti-trap).'
    );
});

test('F-1139 injection seam: window.__vacSetMrLevel setter exported at module scope', () => {
    assert.ok(
        src.includes('window.__vacSetMrLevel = function'),
        'window.__vacSetMrLevel export missing — starvation-path tests need this to override _avMrLevelSynth'
    );
});

test('F-1139 injection seam: window.__vacSetVadStarved setter exported at module scope', () => {
    assert.ok(
        src.includes('window.__vacSetVadStarved = function'),
        'window.__vacSetVadStarved export missing — starvation scenario simulation requires this'
    );
});

test('Gate pattern anchor: _phraseVadTick uses PHRASE_VOICED_TICKS_NEEDED sustained-voiced-run gate (S164)', () => {
    // L-2503/L-2504 (S164): the greeting gate is a LIVENESS gate (sustained voiced run), not content-match.
    // This anchor verifies the post-S164 gate expression is still in source.
    assert.ok(
        src.includes('_phraseVoicedTicks >= PHRASE_VOICED_TICKS_NEEDED'),
        'S164 sustained-voiced-run gate expression not found — phrase gate logic may have changed'
    );
});

test('Gate pattern anchor: phrase gate requires PHRASE_MOD_DELTA modulation (anti-hum)', () => {
    assert.ok(
        src.includes('_phraseVoicedMax - _phraseVoicedMin') && src.includes('PHRASE_MOD_DELTA'),
        'PHRASE_MOD_DELTA modulation gate not found in source — hum-rejection logic may have changed'
    );
});

test('Gate pattern anchor: IOS starvation detector uses 0.02 lower bound and 0.05 reset', () => {
    // The 0.02/0.05 dead-zone is where IOS_AMPLITUDE_CRUSH (3% RMS) falls.
    // This anchor confirms the dead zone values so the bug report stays calibrated.
    assert.ok(
        src.includes('_rms < 0.02') && src.includes('_rms > 0.05'),
        '_vadStarved accumulation bounds (0.02/0.05) not found — IOS_AMPLITUDE_CRUSH bug analysis may be stale'
    );
});

test('Gate pattern anchor: VAD_SPEECH_RMS_FALLBACK in phrase gate scope', () => {
    // Verify the constant exists and can be extracted (it lives inside beginRecording scope)
    assert.ok(
        src.includes('const VAD_SPEECH_RMS_FALLBACK'),
        'VAD_SPEECH_RMS_FALLBACK constant missing from source'
    );
});

// ── Extract live constants from source ───────────────────────────────────────

const PHRASE_VOICED_TICKS_NEEDED = constFromSource('PHRASE_VOICED_TICKS_NEEDED');
const PHRASE_MOD_DELTA           = constFromSource('PHRASE_MOD_DELTA');
const PHRASE_SILENCE_TICKS_NEEDED = constFromSource('PHRASE_SILENCE_TICKS_NEEDED');
const VOICE_BAND_MIN_RATIO       = constFromSource('VOICE_BAND_MIN_RATIO');
const FAST_CAL_FLOOR_MULT        = constFromSource('FAST_CAL_FLOOR_MULT');
const FAST_CAL_THR_MIN           = constFromSource('FAST_CAL_THR_MIN');
const FAST_CAL_THR_MAX           = constFromSource('FAST_CAL_THR_MAX');

// VAD_SPEECH_RMS_FALLBACK and VAD_SILENCE_RMS_FALLBACK are scoped inside beginRecording()
// — extract from the const declaration closest to the phrase gate context.
function localConstFromSource(name) {
    // Match "const NAME = value;" without anchoring to global scope
    const m = src.match(new RegExp('\\bconst\\s+' + name + '\\s*=\\s*([0-9.]+)\\s*;'));
    assert.ok(m, `Expected "const ${name} = <number>;" in ${SRC_PATH}`);
    const v = parseFloat(m[1]);
    assert.ok(!isNaN(v), `${name} could not parse as number: ${m[1]}`);
    return v;
}
const VAD_SPEECH_RMS_FALLBACK  = localConstFromSource('VAD_SPEECH_RMS_FALLBACK');
const VAD_SILENCE_RMS_FALLBACK = localConstFromSource('VAD_SILENCE_RMS_FALLBACK');

// VOICE_BAND_MIN_RATIO is declared TWICE in source (module scope, gates the AV preflight
// mic-qualify block; and again inside beginRecording()'s local scope, gates the phrase gate) —
// constFromSource('VOICE_BAND_MIN_RATIO') above only matched the FIRST (module-scope)
// declaration, since a plain (non-global) regex .match() stops there. Both mirrors in this file
// (makeMicQualifyState + makePhraseVadState) use the single extracted VOICE_BAND_MIN_RATIO value
// for two DIFFERENT gates that read two DIFFERENT source declarations — if a future tune changes
// one without the other, this constant-extraction "drift detector" would silently validate the
// mirror against the wrong one. Assert both declarations still agree so that divergence fails
// loudly here instead of passing silently.
function allConstDeclarationsFromSource(name) {
    const re = new RegExp('\\bconst\\s+' + name + '\\s*=\\s*([0-9.]+)\\s*;', 'g');
    const values = [];
    let m;
    while ((m = re.exec(src)) !== null) values.push(parseFloat(m[1]));
    return values;
}
test('VOICE_BAND_MIN_RATIO: both source declarations (module-scope AV gate + local phrase-gate scope) agree', () => {
    const decls = allConstDeclarationsFromSource('VOICE_BAND_MIN_RATIO');
    assert.equal(decls.length, 2, `expected exactly 2 "const VOICE_BAND_MIN_RATIO = ...;" declarations in source, found ${decls.length} — this test's assumption about the source has changed, update the extraction accordingly`);
    assert.equal(decls[0], decls[1], `VOICE_BAND_MIN_RATIO declarations have diverged: module-scope=${decls[0]} (AV mic-qualify gate) vs local-scope=${decls[1]} (phrase gate) — the two mirrors in this file share one extracted value and would silently test the wrong gate against a stale constant`);
});

test('Verify extracted phrase-gate constants match expected S164 values', () => {
    assert.equal(PHRASE_VOICED_TICKS_NEEDED, 7,    'PHRASE_VOICED_TICKS_NEEDED must be 7 (~1.4s @ 200ms ticks)');
    assert.equal(PHRASE_MOD_DELTA, 0.045,           'PHRASE_MOD_DELTA must be 0.045');
    assert.equal(PHRASE_SILENCE_TICKS_NEEDED, 2,   'PHRASE_SILENCE_TICKS_NEEDED must be 2');
    assert.equal(VOICE_BAND_MIN_RATIO, 0.45,        'VOICE_BAND_MIN_RATIO must be 0.45');
    assert.ok(VAD_SPEECH_RMS_FALLBACK > 0 && VAD_SPEECH_RMS_FALLBACK < 0.15,
        `VAD_SPEECH_RMS_FALLBACK=${VAD_SPEECH_RMS_FALLBACK} out of expected range`);
    assert.ok(VAD_SILENCE_RMS_FALLBACK < VAD_SPEECH_RMS_FALLBACK,
        'VAD_SILENCE_RMS_FALLBACK must be below VAD_SPEECH_RMS_FALLBACK (hysteresis gap)');
});

// ── Gate decision functions (mirrored line-for-line from source) ──────────────
//
// DESIGN: These functions are derived directly from vac-reauth-ceremony.js.
// Mirroring is necessary because the ceremony code runs inside a browser IIFE with DOM
// and AudioContext dependencies that cannot be loaded in Node without a full browser shim.
// The constFromSource() anchors and source-anchor tests above prevent silent divergence:
// if the source changes its gate logic, those tests fail first.

// Mirror of _voiceBandRatio() from source (line ~3789):
//   Uses _totSum = 1 (division guard), same as production code.
function _voiceBandRatioMirror(freqBuf, fftSize, sampleRate) {
    const sr = sampleRate || 48000;
    const sz = fftSize || 256;
    const vbStart = Math.ceil(85 * sz / sr);
    const vbEnd   = Math.floor(3000 * sz / sr);
    let vbSum = 0, totSum = 1;
    for (let i = 0; i < freqBuf.length; i++) { totSum += freqBuf[i]; if (i >= vbStart && i <= vbEnd) vbSum += freqBuf[i]; }
    return vbSum / totSum;
}

// Mirror of RMS computation from _phraseVadTick (line ~4876):
//   sqrt(mean((buf[i]-128)^2)) / 128
function _computeRmsMirror(tdBuf) {
    let s = 0;
    for (let i = 0; i < tdBuf.length; i++) { const d = tdBuf[i] - 128; s += d * d; }
    return Math.sqrt(s / tdBuf.length) / 128;
}

// Mirror of _phraseVadTick state machine from vac-reauth-ceremony.js (line ~4863).
// Each call to tick() simulates one 200ms phrase-interval firing.
// vadStarved and mrLevelSynth may be overridden per-tick for starvation scenarios.
function makePhraseVadState() {
    let phraseVoicedTicks = 0;
    let phraseVoicedMin   = 1;
    let phraseVoicedMax   = 0;
    let phraseSilenceTicks = 0;
    let phraseSilentRun   = 0;
    let vadStarved        = false;
    let phraseSpoke       = false;
    let phraseHeardVoice  = false;
    let phraseContentMatched = false; // assume no content gate for this harness
    let sessionGateAvail  = false;    // content gate disabled in Node (no SpeechRecognition)

    function tick(tdBuf, freqBuf, { overrideMrLevel = 0, overrideVadStarved = false } = {}) {
        if (phraseSpoke) return getState();

        const _vadStarved = overrideVadStarved || vadStarved;
        const _avMrLevelSynth = overrideMrLevel;

        // Mirror of _phraseVadTick computation (line ~4873-4983):
        let _rms = _computeRmsMirror(tdBuf);
        const _vbRatio = _voiceBandRatioMirror(freqBuf);

        // Starvation accumulator (mirror of line ~4899):
        if (_rms < 0.02) {
            // would increment _vadStarvedRun — we don't track across sessions in this mirror
        }

        // Spectral path (mirror of t745/t735 — dead zone + starvation both route here):
        let _mb = 0; for (let i = 0; i < freqBuf.length; i++) _mb += freqBuf[i];
        const _deadZone = (_rms > VAD_SILENCE_RMS_FALLBACK) && (_rms < VAD_SPEECH_RMS_FALLBACK);
        const _spectralVoiced = (_vadStarved || _deadZone) && (
            (_avMrLevelSynth >= 8) ||
            ((_mb / freqBuf.length >= 2) && (_vbRatio >= VOICE_BAND_MIN_RATIO))
        );

        // Silence branch (mirror of line ~4965-4980):
        if (!_spectralVoiced && _rms < VAD_SILENCE_RMS_FALLBACK) {
            if (!phraseHeardVoice) {
                // Decay voiced run on silence
                phraseVoicedTicks = Math.max(0, phraseVoicedTicks - 1);
                if (phraseVoicedTicks === 0) { phraseVoicedMin = 1; phraseVoicedMax = 0; }
            } else {
                phraseSilenceTicks++;
                if (phraseSilenceTicks >= PHRASE_SILENCE_TICKS_NEEDED) {
                    phraseSpoke = true;
                }
            }
            phraseSilentRun++;
        } else if (_spectralVoiced || (_rms > VAD_SPEECH_RMS_FALLBACK && _vbRatio >= VOICE_BAND_MIN_RATIO)) {
            // Voiced branch (mirror of line ~4912-4963):
            phraseSilenceTicks = 0;
            phraseSilentRun = 0;
            phraseVoicedTicks++;
            if (_rms < phraseVoicedMin) phraseVoicedMin = _rms;
            if (_rms > phraseVoicedMax) phraseVoicedMax = _rms;

            // Modulation check: sustained + modulated voiced run; spectral path bypasses modulation
            const mod = phraseVoicedMax - phraseVoicedMin;
            if (phraseVoicedTicks >= PHRASE_VOICED_TICKS_NEEDED && (_vadStarved || _spectralVoiced || mod >= PHRASE_MOD_DELTA)) {
                phraseHeardVoice = true;
            }
        }
        // neither band: hold counters unchanged (no else branch needed)

        return getState();
    }

    function getState() {
        return {
            phraseVoicedTicks,
            phraseVoicedMin,
            phraseVoicedMax,
            phraseSilenceTicks,
            phraseHeardVoice,
            phraseSpoke,
            modulation: parseFloat((phraseVoicedMax - phraseVoicedMin).toFixed(4)),
        };
    }

    return { tick, getState };
}

// Mirror of the mic-qualify block from runAVFrame in vac-reauth-ceremony.js.
// Simulates the two qualify paths:
//   Path A (_avVbSustain >= 25): voice-band EMA sustained rise above slow baseline
//   Path B (_micLoudFrames >= 3 after seed): amplitude qualify with optional _runVoiced override (t723 iOS)
function makeMicQualifyState() {
    // Seed window state
    let micSeeded          = false;
    let micSeedStartT      = 0;
    let micSeedLevels      = [];
    let micSeedRmsSamples  = [];
    let micSeededAmbient   = 0;
    let micSeededAmbientRms = 0;

    // Level history (2s rolling window)
    let micLevelHistory  = [];
    let micRunLevels     = [];
    let micRunRatios     = [];
    let micRunRmsSamples = [];
    let micLoudFrames    = 0;
    let micRunStartT     = 0;
    let micLastQualifyT  = 0;

    // Voice-band path (t725/t726/t730)
    let avVbEma    = 0;
    let avVbSlow   = 0;
    let avVbSustain = 0;

    let avChecks_mic = false;
    let frameT       = 0;  // simulated wall-clock ms (increments by ~16ms per frame at 60fps)
    const FRAME_MS = 16;
    const SEED_DURATION_MS = 1500;  // mirrors the 1500ms seed window in source

    function _micQualifyFloor(voiced) {
        const mult  = voiced ? 1.15 : 2;
        const floor = voiced ? 8 : 12;
        return Math.max(mult * micSeededAmbient, floor);
    }

    function tick(tdBuf, freqBuf, mrLevel) {
        mrLevel = mrLevel || 0;
        frameT += FRAME_MS;

        // Compute level (peak-based, mirrors runAVFrame line ~1355-1360):
        let maxDev = 0;
        for (let i = 0; i < tdBuf.length; i++) { const d = Math.abs(tdBuf[i] - 128); if (d > maxDev) maxDev = d; }
        let level = Math.min(100, Math.round((maxDev / 128) * 100));

        // Apply MR level override if analyser starved (mirrors line ~1381-1383):
        if (mrLevel > 0) level = mrLevel;

        // Ceremony RMS (mirrors line ~1414-1416):
        let ceremonyRms = 0;
        for (let i = 0; i < tdBuf.length; i++) { const d = tdBuf[i] - 128; ceremonyRms += d * d; }
        ceremonyRms = Math.sqrt(ceremonyRms / tdBuf.length) / 128;

        // Speech ratio (mirrors line ~1392-1407):
        let speechRatio = 0;
        {
            let bandSum = 0, totalSum = 0;
            for (let i = 0; i < freqBuf.length; i++) {
                totalSum += freqBuf[i];
                if (i >= 1 && i <= 16) bandSum += freqBuf[i];
            }
            const meanBin = totalSum / freqBuf.length;
            speechRatio = (meanBin >= 3) ? (bandSum / totalSum) : -1;
        }

        // Seed window (mirrors line ~1507-1517):
        if (!micSeeded) {
            if (micSeedStartT === 0) micSeedStartT = frameT;
            micSeedLevels.push(level);
            micSeedRmsSamples.push(ceremonyRms);
            if (frameT - micSeedStartT >= SEED_DURATION_MS) {
                const sorted = micSeedLevels.slice().sort((a, b) => a - b);
                micSeededAmbient = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
                const rmsSorted = micSeedRmsSamples.slice().sort((a, b) => a - b);
                micSeededAmbientRms = rmsSorted.length ? rmsSorted[Math.floor(rmsSorted.length / 2)] : 0;
                micSeeded = true;
            }
        }

        // Update level history (2s rolling window — mirrors line ~1519-1520):
        micLevelHistory.push({ t: frameT, level });
        while (micLevelHistory.length && micLevelHistory[0].t < frameT - 2000) micLevelHistory.shift();

        // Path A: voice-band EMA sustained rise (t725/t726/t730 — mirrors line ~1471-1488):
        if (speechRatio >= 0) { avVbEma = 0.85 * avVbEma + 0.15 * speechRatio; }
        if (speechRatio >= 0) { avVbSlow = (avVbSlow === 0) ? avVbEma : (0.995 * avVbSlow + 0.005 * avVbEma); }
        const t727Corrob = (level >= 3) || (mrLevel >= 8);
        const t730Rise   = (avVbEma - avVbSlow) >= 0.10;
        if (speechRatio >= 0 && avVbEma >= VOICE_BAND_MIN_RATIO && t727Corrob && t730Rise) { avVbSustain++; }
        else if (speechRatio >= 0) { avVbSustain = Math.max(0, avVbSustain - 1); }
        if (avVbSustain >= 25 && !avChecks_mic) {
            micLastQualifyT = frameT;
            avChecks_mic = true;
        }

        // Path B: amplitude qualify run (mirrors line ~1533-1591):
        const runRatioSoFar = micRunRatios.length
            ? micRunRatios.slice().sort((a, b) => a - b)[Math.floor(micRunRatios.length / 2)]
            : speechRatio;
        if (level > _micQualifyFloor(runRatioSoFar >= VOICE_BAND_MIN_RATIO)) {
            if (micLoudFrames === 0) micRunStartT = frameT;
            micLoudFrames++;
            micRunLevels.push(level);
            micRunRatios.push(speechRatio);
            micRunRmsSamples.push(ceremonyRms);
        } else {
            micLoudFrames = 0;
            micRunLevels = [];
            micRunRatios = [];
            micRunRmsSamples = [];
        }
        if (micLoudFrames >= 3 && micSeeded) {
            const ambient = micLevelHistory.filter(e => e.t < micRunStartT).map(e => e.level).sort((a, b) => a - b);
            const ambientMedian = ambient.length ? ambient[Math.floor(ambient.length / 2)] : 0;
            const run = micRunLevels.slice().sort((a, b) => a - b);
            const runMedian = run[Math.floor(run.length / 2)];
            const ratioSorted = micRunRatios.slice().sort((a, b) => a - b);
            const runRatioMedian = ratioSorted.length ? ratioSorted[Math.floor(ratioSorted.length / 2)] : 0;
            const runVoiced = runRatioMedian >= VOICE_BAND_MIN_RATIO;
            const ambientMult = runVoiced ? 1.15 : 2;
            const qualifyFloor = Math.max(ambientMult * ambientMedian, _micQualifyFloor(runVoiced));
            // t723: _runVoiced proves working mic even when amplitude is crushed (iOS fix)
            if ((runMedian > qualifyFloor || runVoiced) && !avChecks_mic) {
                micLastQualifyT = frameT;
                avChecks_mic = true;
            }
        }

        return getState();
    }

    function getState() {
        return {
            green: avChecks_mic,
            micSeeded,
            micSeededAmbient: parseFloat(micSeededAmbient.toFixed(2)),
            avVbSustain,
            avVbEma: parseFloat(avVbEma.toFixed(4)),
            micLoudFrames,
            frameT,
        };
    }

    return { tick, getState };
}

// ── Helper: run N frames of a fixture through a gate ─────────────────────────

function runPhraseGate(fixture, opts) {
    const gate = makePhraseVadState();
    let finalState = null;
    const opts_ = opts || {};
    for (const { tdBuf, freqBuf } of fixture.frames) {
        finalState = gate.tick(tdBuf, freqBuf, {
            overrideMrLevel:     opts_.mrLevel     || 0,
            overrideVadStarved:  opts_.vadStarved  || false,
        });
        if (finalState.phraseSpoke) break;
    }
    return finalState;
}

function runMicQualify(fixture, opts) {
    const gate = makeMicQualifyState();
    let finalState = null;
    for (const { tdBuf, freqBuf } of fixture.frames) {
        finalState = gate.tick(tdBuf, freqBuf, (opts && opts.mrLevel) || 0);
        if (finalState.green) break;
    }
    return finalState;
}

// ── PHRASE GATE tests ─────────────────────────────────────────────────────────

test('PHRASE: clean_greeting fires phraseSpoke after sustained voiced run', () => {
    const result = runPhraseGate(FIXTURES.clean_greeting);
    assert.ok(result.phraseSpoke,
        `clean_greeting should have fired phraseSpoke in ${FIXTURES.clean_greeting.nFrames} ticks. ` +
        `voicedTicks=${result.phraseVoicedTicks}, mod=${result.modulation}`);
    assert.ok(result.phraseVoicedTicks >= PHRASE_VOICED_TICKS_NEEDED,
        `Expected >= ${PHRASE_VOICED_TICKS_NEEDED} voiced ticks, got ${result.phraseVoicedTicks}`);
});

test('PHRASE: silence never fires phraseSpoke', () => {
    const result = runPhraseGate(FIXTURES.silence);
    assert.ok(!result.phraseSpoke,
        `silence should NOT fire phraseSpoke but did after ${result.phraseVoicedTicks} voiced ticks`);
    assert.equal(result.phraseVoicedTicks, 0, 'silence should accumulate 0 voiced ticks');
});

test('PHRASE: single_tap does not accumulate enough voiced ticks to fire', () => {
    const result = runPhraseGate(FIXTURES.single_tap);
    assert.ok(!result.phraseSpoke,
        `single_tap should NOT fire phraseSpoke — a one-tick spike cannot reach ${PHRASE_VOICED_TICKS_NEEDED} sustained ticks`);
    assert.ok(result.phraseVoicedTicks < PHRASE_VOICED_TICKS_NEEDED,
        `Expected < ${PHRASE_VOICED_TICKS_NEEDED} voiced ticks from single tap, got ${result.phraseVoicedTicks}`);
});

test('PHRASE: sustained_hum does not advance (voice-band ratio below threshold)', () => {
    const result = runPhraseGate(FIXTURES.sustained_hum);
    // hum energy concentrates at bin 0 (60Hz) — outside VOICE_BAND_START..VOICE_BAND_END (1..16)
    // → vbRatio ≈ 0.01 < 0.45 → voiced branch never fires
    assert.ok(!result.phraseSpoke,
        `sustained_hum should NOT fire phraseSpoke — hum is below voice-band threshold. ` +
        `voicedTicks=${result.phraseVoicedTicks}, mod=${result.modulation}`);
});

test('PHRASE: background_tv does not advance (vbRatio below threshold AND amplitude marginal)', () => {
    const result = runPhraseGate(FIXTURES.background_tv);
    assert.ok(!result.phraseSpoke,
        `background_tv should NOT fire phraseSpoke. voicedTicks=${result.phraseVoicedTicks}`);
});

test('PHRASE [DOCUMENTS BEHAVIOR]: second_speaker — records whether voice-like energy from another person advances gate', () => {
    const result = runPhraseGate(FIXTURES.second_speaker);
    // APCER scenario: second speaker has voice-band energy; gate may or may not fire.
    // The server's content gate (transcript match) is the authoritative defense.
    // This test documents current behavior without asserting a specific outcome.
    const outcome = result.phraseSpoke ? 'FIRES (APCER scenario)' : 'STUCK (gate rejects)';
    assert.ok(true, `second_speaker: ${outcome} — voicedTicks=${result.phraseVoicedTicks}, mod=${result.modulation}`);
    // Record for CEREMONY-HARNESS-RESULTS-S164.md
});

test('PHRASE [DOCUMENTS BEHAVIOR]: greeting_at_3m — records gate behavior at attenuated distance signal', () => {
    const result = runPhraseGate(FIXTURES.greeting_at_3m);
    const rms0 = rmsOfTdBuf(FIXTURES.greeting_at_3m.frames[0].tdBuf);
    const outcome = result.phraseSpoke
        ? `FIRES (RMS=${rms0.toFixed(3)} clears VAD_SPEECH_RMS_FALLBACK=${VAD_SPEECH_RMS_FALLBACK})`
        : `STUCK (RMS=${rms0.toFixed(3)} below VAD_SPEECH_RMS_FALLBACK=${VAD_SPEECH_RMS_FALLBACK})`;
    assert.ok(true, `greeting_at_3m: ${outcome} — voicedTicks=${result.phraseVoicedTicks}`);
});

// ── IOS_AMPLITUDE_CRUSH — PRIORITY bug fixture ───────────────────────────────

test('PHRASE [FIX VERIFIED]: IOS_AMPLITUDE_CRUSH — dead-zone voice-band path fires (RMS~3%, vbRatio healthy)', () => {
    // t745/L-2505 fix: iOS crushes time-domain RMS to ~3% (0.031) but preserves spectral shape.
    // The dead zone path (_deadZone = rms > VAD_SILENCE_RMS_FALLBACK && rms < VAD_SPEECH_RMS_FALLBACK)
    // routes to the same spectral/MR check as the starvation escape — fires when vbRatio >= 0.45
    // AND mean FFT bin >= 2 (voice-band energy present). Modulation check bypassed when _spectralVoiced.

    const fixture = FIXTURES.IOS_AMPLITUDE_CRUSH;
    const rms0    = rmsOfTdBuf(fixture.frames[0].tdBuf);
    const vbr0    = vbRatioOfFreqBuf(fixture.frames[0].freqBuf);
    const result  = runPhraseGate(fixture);

    // Verify fixture parameters are correct (dead-zone calibration)
    assert.ok(rms0 < VAD_SPEECH_RMS_FALLBACK,
        `IOS_AMPLITUDE_CRUSH: fixture RMS=${rms0.toFixed(3)} must be below VAD_SPEECH_RMS_FALLBACK=${VAD_SPEECH_RMS_FALLBACK} (dead zone)`);
    assert.ok(rms0 > VAD_SILENCE_RMS_FALLBACK,
        `IOS_AMPLITUDE_CRUSH: fixture RMS=${rms0.toFixed(3)} must be above VAD_SILENCE_RMS_FALLBACK=${VAD_SILENCE_RMS_FALLBACK} (not silence)`);
    assert.ok(vbr0 >= VOICE_BAND_MIN_RATIO,
        `IOS_AMPLITUDE_CRUSH: voice-band ratio=${vbr0.toFixed(3)} must be >= ${VOICE_BAND_MIN_RATIO} (voice-band-healthy)`);

    // Fix verified: dead-zone spectral path fires phraseSpoke
    assert.ok(result.phraseSpoke,
        `IOS_AMPLITUDE_CRUSH should fire phraseSpoke via dead-zone spectral path. ` +
        `voicedTicks=${result.phraseVoicedTicks}, rms=${rms0.toFixed(3)}, vbr=${vbr0.toFixed(3)}`);
    assert.ok(result.phraseVoicedTicks >= PHRASE_VOICED_TICKS_NEEDED,
        `IOS_AMPLITUDE_CRUSH: expected >= ${PHRASE_VOICED_TICKS_NEEDED} voiced ticks, got ${result.phraseVoicedTicks}`);
});

test('PHRASE [STARVATION ESCAPE]: IOS_AMPLITUDE_CRUSH with _vadStarved=true AND MR level>=8 → gate fires', () => {
    // Control scenario: when the STARVATION path IS activated (vadStarved+mrLevel set via injectors),
    // the gate DOES advance. This proves the starvation escape path works; the bug is only that
    // the dead-zone RMS (3%) never TRIGGERS starvation detection automatically.
    const fixture = FIXTURES.IOS_AMPLITUDE_CRUSH;
    const result  = runPhraseGate(fixture, { vadStarved: true, mrLevel: 20 });
    assert.ok(result.phraseSpoke || result.phraseHeardVoice || result.phraseVoicedTicks >= PHRASE_VOICED_TICKS_NEEDED,
        `With vadStarved=true and mrLevel=20, gate should advance via spectral path. ` +
        `voicedTicks=${result.phraseVoicedTicks}, phraseSpoke=${result.phraseSpoke}`);
});

// ── MIC-QUALIFY gate tests ────────────────────────────────────────────────────

test('MIC-QUALIFY: clean_greeting greens Mic pill', () => {
    const result = runMicQualify(MIC_FIXTURES.clean_greeting);
    assert.ok(result.green,
        `clean_greeting should qualify the mic. avVbSustain=${result.avVbSustain}, micSeededAmbient=${result.micSeededAmbient}`);
});

test('MIC-QUALIFY: silence never greens Mic pill', () => {
    const result = runMicQualify(MIC_FIXTURES.silence);
    assert.ok(!result.green,
        `silence should not green the mic pill. avVbSustain=${result.avVbSustain}`);
});

test('MIC-QUALIFY: single_tap does not green (1 frame below sustained-run threshold)', () => {
    const result = runMicQualify(MIC_FIXTURES.single_tap);
    assert.ok(!result.green,
        `single_tap should not green the mic pill (< 3 consecutive loud frames). avVbSustain=${result.avVbSustain}`);
});

test('MIC-QUALIFY [DOCUMENTS BEHAVIOR]: IOS_AMPLITUDE_CRUSH — records whether voice-band path greens mic', () => {
    // On real iOS, the voice-band EMA path (t725 SAGA-DEAF-03 fix) may still green the mic
    // even when amplitude is crushed to 3%. This is EXPECTED behavior (t723: "voice-band energy
    // present proves a working mic even when _runMedian <= floor").
    // Documents for CEREMONY-HARNESS-RESULTS-S164.md: mic pill might green, but phrase gate stuck.
    const result = runMicQualify(MIC_FIXTURES.IOS_AMPLITUDE_CRUSH);
    const outcome = result.green ? 'GREENS (voice-band path)' : 'RED (all paths blocked)';
    // No hard assertion on the outcome — this is a documentation fixture
    assert.ok(true, `IOS_AMPLITUDE_CRUSH mic-qualify: ${outcome} — avVbSustain=${result.avVbSustain}, avVbEma=${result.avVbEma}`);
    // The important finding: even if mic pill GREENS (proving mic works), phrase gate STAYS STUCK.
    // Both: mic green + phrase stuck = the full iOS bug surface (user sees "Mic: working" but greeting never fires)
});

test('MIC-QUALIFY [DOCUMENTS BEHAVIOR]: sustained_hum — seed mechanism effect on hum', () => {
    const result = runMicQualify(MIC_FIXTURES.sustained_hum);
    // If hum is present from frame 0, seed window absorbs it → seededAmbient = hum level → floor rises
    // Expected: mic stays red OR barely greens if seed floor absorbs hum
    assert.ok(true, `sustained_hum mic-qualify: green=${result.green}, seededAmbient=${result.micSeededAmbient}`);
});

// ── APCER/BPCER matrix summary ────────────────────────────────────────────────
// (methodologically-aligned framing, NOT certified — VAC-PA-001 sec 12.2)

test('MATRIX: record APCER/BPCER classification for all phrase-gate fixtures', () => {
    // BPCER: bona-fide rejection rate (legitimate user fails)
    // APCER: attack presentation classification error rate (impostor passes)
    //
    // For the PHRASE gate:
    //   True Positive (bona fide user fires):    clean_greeting should fire
    //   True Negative (non-voice stays stuck):   silence, single_tap, sustained_hum, background_tv
    //   IOS_AMPLITUDE_CRUSH:                      bona-fide user FAILS → BPCER contribution
    //   second_speaker:                           APCER scenario (records, does not assert)
    //   greeting_at_3m:                           BPCER risk scenario (marginal)

    const matrix = {};
    for (const [name, fixture] of Object.entries(FIXTURES)) {
        const result = runPhraseGate(fixture);
        matrix[name] = {
            phraseSpoke:       result.phraseSpoke,
            voicedTicks:       result.phraseVoicedTicks,
            modulation:        result.modulation,
            fixtureRms:        rmsOfTdBuf(fixture.frames[0].tdBuf),
            fixtureVbr:        vbRatioOfFreqBuf(fixture.frames[0].freqBuf),
            expectedOutcome:   fixture.expectedOutcome,
        };
    }

    // BPCER check: clean_greeting must fire (bona fide user must not be rejected)
    assert.ok(matrix.clean_greeting.phraseSpoke,
        `BPCER: clean_greeting must fire (bona fide acceptance). Fix: increase modulation or frames.`);

    // True-negative check: silence, single_tap, sustained_hum, background_tv must NOT fire
    for (const name of ['silence', 'single_tap', 'sustained_hum', 'background_tv']) {
        assert.ok(!matrix[name].phraseSpoke,
            `Liveness: ${name} must NOT fire phraseSpoke (non-bona-fide signal rejected)`);
    }

    // IOS_AMPLITUDE_CRUSH: dead-zone fix (t745) — bona-fide user must now fire
    assert.ok(matrix.IOS_AMPLITUDE_CRUSH.phraseSpoke,
        `IOS_AMPLITUDE_CRUSH: dead-zone fix must fire phraseSpoke. ` +
        `RMS=${matrix.IOS_AMPLITUDE_CRUSH.fixtureRms.toFixed(3)} voice-band healthy → spectral path`);

    // Log full matrix for results doc
    // (visible in `node --test` output)
    const lines = ['', '=== PHRASE GATE APCER/BPCER MATRIX (S164 F-1139) ==='];
    for (const [name, row] of Object.entries(matrix)) {
        const outcome = row.phraseSpoke ? 'FIRES' : 'STUCK';
        const flag = row.expectedOutcome === 'PHRASE_FIRES' && !row.phraseSpoke ? ' ← BPCER FAILURE'
                   : row.expectedOutcome === 'PHRASE_STUCK' && row.phraseSpoke  ? ' ← APCER FAILURE'
                   : '';
        lines.push(`  ${name.padEnd(25)} ${outcome}  rms=${row.fixtureRms.toFixed(3)} vbr=${row.fixtureVbr.toFixed(3)} ticks=${row.voicedTicks} mod=${row.modulation}${flag}`);
    }
    lines.push('=== END MATRIX ===', '');
    // Output visible in CI logs
    process.stdout.write(lines.join('\n') + '\n');
});
