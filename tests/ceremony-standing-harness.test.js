// ceremony-standing-harness.test.js — t740 Ceremony Standing Test Harness (TSH)
//
// WHAT THIS IS: regression harness for every defect in the ceremony audio saga.
// Each test fixture catches a real bug that cost real debugging time. They fail if the
// fix is reintroduced, catching regressions before they reach production.
//
// SAGA DEFECTS COVERED:
//   SAGA-GC-01    t736 GC-unpinned source node: Chrome GCs anonymous MediaStreamAudioSourceNodes
//                 → analyser reads silence forever while MediaRecorder still hears. Fix: _pinSrc()
//                 pushes every source node into window.__vacPinnedSources.
//   SAGA-AGC-02   t733 AGC-off starvation: disabling autoGainControl left raw mic at ~1-2%
//                 (speaking distance), below all thresholds. Browser AGC is what yields the
//                 20-60% the system was calibrated for. Fix: audio:true (browser defaults).
//   SAGA-DEAF-03  t727 Deaf-meter-gating: at 1% amplitude the FFT is quantization noise whose
//                 voice-band ratio is a coin flip. Fix: _meanBin >= 3 guard before counting ratio.
//   SAGA-UNDECLARED-04  t729 Undeclared-var frame-loop death: reading _avDispTick before its
//                 let declaration threw ReferenceError in the rAF loop, killing the AV frame
//                 loop (all indicators dead). Fix: let _avDispTick = 0 at module scope.
//   SAGA-ZONE-05  Zone-radius shrink: multiple bugs where rx/ry shrank back toward center,
//                 making the beside-cheek pose geometrically impossible. Fix: locked values.
//   SAGA-SILENT-06  t740 Silent-track: OS not sending audio to browser; analyser reads zero;
//                 no human sensor → 2 days of debugging. Fix: synthetic self-test + banner.
//
// Run: node --test tests/ceremony-standing-harness.test.js

'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const SRC_PATH = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

// ── SAGA-GC-01: GC-unpinned MediaStreamAudioSourceNode (t736) ────────────────
//
// Root: Chrome GCs MediaStreamAudioSourceNodes created in local const expressions.
// After GC the analyser reads silence forever; MediaRecorder keeps hearing.
// Fix: every creation site wraps with _pinSrc() which pushes to window.__vacPinnedSources.

test('SAGA-GC-01: window.__vacPinnedSources array is declared at module scope', () => {
    assert.ok(
        src.includes('window.__vacPinnedSources = window.__vacPinnedSources || []'),
        'window.__vacPinnedSources must be initialised at module scope — ' +
        'removes on re-entry without losing prior pins (t736 fix)'
    );
});

test('SAGA-GC-01: _pinSrc pushes the source node into window.__vacPinnedSources', () => {
    const fnIdx = src.indexOf('function _pinSrc(');
    assert.ok(fnIdx >= 0, '_pinSrc function must be defined in source');
    // extract function body by brace-counting
    let depth = 0, i = fnIdx;
    while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
    while (i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { i++; break; } } i++; }
    const body = src.slice(fnIdx, i);
    assert.ok(
        body.includes('window.__vacPinnedSources.push(node)'),
        '_pinSrc must push node into window.__vacPinnedSources — GC prevention requires a live reference'
    );
});

test('SAGA-GC-01: avAudioCtx.createMediaStreamSource calls are wrapped with _pinSrc (t736 GC fix)', () => {
    // The GC bug specifically affected avAudioCtx (the AV pre-flight analyser). Every call site
    // on avAudioCtx must be _pinSrc(avAudioCtx.createMediaStreamSource(...)) not bare.
    // The ceremony audioContext and warmup warmCtx are separate — their lifetime guarantees differ.
    const avCtxPattern = /avAudioCtx\.createMediaStreamSource\s*\(/g;
    const baresInSource = [];
    let m;
    while ((m = avCtxPattern.exec(src)) !== null) {
        const pre = src.slice(Math.max(0, m.index - 20), m.index);
        if (!pre.includes('_pinSrc')) {
            baresInSource.push({ offset: m.index, snippet: src.slice(m.index, m.index + 60) });
        }
    }
    assert.deepEqual(
        baresInSource, [],
        'Every avAudioCtx.createMediaStreamSource call must be wrapped with _pinSrc() — ' +
        'bare calls are GC-eligible and cause the analyser to silently read zeros (t736):\n' +
        JSON.stringify(baresInSource, null, 2)
    );
});

// ── SAGA-AGC-02: AGC-off starvation (t733) ───────────────────────────────────
//
// Root: task-720 disabled autoGainControl to "fix" Rob's Mac 1% problem, but raw mic
// at speaking distance IS ~1-2%; AGC is what yields the 20-60% the thresholds expect.
// Fix: audio:true (browser defaults, which include AGC).

test('SAGA-AGC-02: getUserMedia must use audio:true (no autoGainControl:false)', () => {
    // The pattern that caused the regression: audio: { autoGainControl: false, ... }
    const agcOffPattern = /autoGainControl\s*:\s*false/;
    assert.ok(
        !agcOffPattern.test(src),
        'autoGainControl:false must not appear in source — t733: disabling AGC leaves raw mic ' +
        'at ~1-2% (speaking distance); all thresholds calibrated for AGC-boosted 20-60%'
    );
});

test('SAGA-AGC-02: getUserMedia audio constraint is bare true (browser AGC defaults intact)', () => {
    // The fixed constraint pattern: audio: true (or audio: { facingMode, ... } without AGC overrides)
    // We specifically verify that where getUserMedia is called with video + audio together,
    // the audio value is not an object with negative AGC override.
    assert.ok(
        src.includes('audio: true,') || src.includes('audio: true }'),
        'getUserMedia audio constraint must be bare `true` so browser AGC defaults are preserved — ' +
        'raw mic at speaking distance is ~1-2%; AGC brings it to the 20-60% all VAD thresholds expect'
    );
});

// ── SAGA-DEAF-03: Deaf-meter-gating (t727) ────────────────────────────────────
//
// Root: at 1% amplitude the FFT bins contain quantization noise whose voice-band ratio
// is a 0↔100 coin flip — a smoothed coin flip hovers ~50% and passed the 45% bar on
// SILENCE. Fix: only count the ratio when mean bin energy >= 3 (real spectrum energy).

test('SAGA-DEAF-03: voice-band ratio gated on mean bin energy >= 3 (deaf-meter guard)', () => {
    assert.ok(
        src.includes('_meanBin >= 3'),
        '_meanBin >= 3 guard must be present — at 1% RMS the FFT is quantization noise ' +
        'whose band-ratio is a coin flip; below the energy floor the frame must be NEUTRAL ' +
        '(neither builds nor decays the sustain counter)'
    );
});

test('SAGA-DEAF-03: neutral sentinel -1 used for no-energy frames (coin-flip frames skipped)', () => {
    assert.ok(
        src.includes('_speechRatio = (_meanBin >= 3) ? (_bandSum / _totalSum) : -1'),
        'voice-band ratio must use -1 sentinel for no-energy frames — ' +
        'this prevents the 0↔100 coin flip from contributing to the smoothed ratio (t727)'
    );
});

// ── SAGA-UNDECLARED-04: Undeclared-var frame-loop death (t729) ────────────────
//
// Root: _avDispTick was used in the rAF loop display throttle but never declared with `let`.
// Reading it threw ReferenceError in strict mode, killing the entire AV frame loop
// (all indicators went dead — light, mic, hand chip, RMS bar). Fix: let _avDispTick = 0.

test('SAGA-UNDECLARED-04: _avDispTick declared with let at module scope (not implicit global)', () => {
    // Must be declared with `let` at module scope (not inside a function)
    const m = src.match(/let\s+_avDispTick\s*=\s*0/);
    assert.ok(
        m,
        'let _avDispTick = 0 must be declared at module scope — t729: undeclared variable threw ' +
        'ReferenceError in the rAF loop display throttle, killing all AV indicators'
    );
    // Confirm it appears BEFORE runAVFrame (module scope, not inside the function)
    const declIdx  = src.indexOf('let _avDispTick = 0');
    const frameIdx = src.indexOf('function runAVFrame(');
    assert.ok(
        declIdx >= 0 && frameIdx >= 0 && declIdx < frameIdx,
        '_avDispTick must be declared before runAVFrame — it must be module-scope, not function-local'
    );
});

// ── SAGA-ZONE-05: Zone-radius shrink ──────────────────────────────────────────
//
// Multiple bugs where rx/ry shrank back toward old values (0.17/0.22) making the
// beside-cheek pose geometrically impossible. Fix: locked at rx=0.21 ry=0.26.
// Also: minTipsInside=2 (was 3) and _FACE_SIDE_GAP=0.10 (was 0.03).

test('SAGA-ZONE-05: GESTURE_ZONE_SPEC.rx >= 0.21 (no zone-radius shrink)', () => {
    const m = src.match(/rx\s*:\s*([\d.]+)/);
    assert.ok(m, 'GESTURE_ZONE_SPEC.rx must be defined');
    const val = parseFloat(m[1]);
    assert.ok(
        val >= 0.21,
        `GESTURE_ZONE_SPEC.rx=${val} must be >= 0.21 — shrink to 0.17 makes beside-cheek pose geometrically impossible`
    );
});

test('SAGA-ZONE-05: GESTURE_ZONE_SPEC.ry >= 0.26 (no zone-radius shrink)', () => {
    const m = src.match(/ry\s*:\s*([\d.]+)/);
    assert.ok(m, 'GESTURE_ZONE_SPEC.ry must be defined');
    const val = parseFloat(m[1]);
    assert.ok(
        val >= 0.26,
        `GESTURE_ZONE_SPEC.ry=${val} must be >= 0.26 — shrink to 0.22 makes natural poses fail`
    );
});

test('SAGA-ZONE-05: GESTURE_ZONE_SPEC.minTipsInside <= 2 (palm-centre OR 2 fingertips accepted)', () => {
    const m = src.match(/minTipsInside\s*:\s*(\d+)/);
    assert.ok(m, 'GESTURE_ZONE_SPEC.minTipsInside must be defined');
    const val = parseInt(m[1], 10);
    assert.ok(
        val <= 2,
        `GESTURE_ZONE_SPEC.minTipsInside=${val} must be <= 2 — was 3, caused wide-oval pose to be rejected`
    );
});

// ── SAGA-SILENT-06: Silent-track sensor (t740) ────────────────────────────────
//
// Root: OS-level privacy block or wrong audio device gives the browser a live-but-silent
// track. The analyser reads zeros, all thresholds fail, and no automated sensor identified
// the cause — a human spent two days debugging before Chrome's own panel showed
// "No microphone available". Fix: synthetic self-test + first-class banner.

test('SAGA-SILENT-06: _runSyntheticAudioSelfTest function present in source', () => {
    assert.ok(
        src.includes('function _runSyntheticAudioSelfTest('),
        '_runSyntheticAudioSelfTest must be defined — t740: oscillator injected into same analyser ' +
        'proves pipeline works without a human, separating broken-graph from silent-device'
    );
});

test('SAGA-SILENT-06: synthetic self-test uses createOscillator and connects to avAnalyser', () => {
    const fnIdx = src.indexOf('function _runSyntheticAudioSelfTest(');
    assert.ok(fnIdx >= 0, '_runSyntheticAudioSelfTest must be defined');
    let depth = 0, i = fnIdx;
    while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
    while (i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { i++; break; } } i++; }
    const body = src.slice(fnIdx, i);
    assert.ok(body.includes('createOscillator'), 'self-test must create an oscillator node');
    assert.ok(body.includes('gain.connect(avAnalyser)'), 'oscillator must connect to avAnalyser (the SAME graph)');
    assert.ok(body.includes('getByteTimeDomainData'), 'self-test must read time-domain RMS (same as VAD)');
    assert.ok(body.includes('window.__vacSynthSelfTestResult'), 'result must be stored on window for CI testability');
});

test('SAGA-SILENT-06: synthetic self-test result is beaconed via vacDebug', () => {
    assert.ok(
        src.includes("vacDebug('synthetic_selftest_result'"),
        "synthetic_selftest_result must be beaconed via vacDebug — CI health check can query it"
    );
});

test('SAGA-SILENT-06: _showSilentTrackBanner function present in source', () => {
    assert.ok(
        src.includes('function _showSilentTrackBanner('),
        '_showSilentTrackBanner must be defined — t740: first-class UI state, not a debug line'
    );
});

test('SAGA-SILENT-06: silent-track banner contains Mac System Settings instruction', () => {
    const fnIdx = src.indexOf('function _showSilentTrackBanner(');
    assert.ok(fnIdx >= 0, '_showSilentTrackBanner must be defined');
    let depth = 0, i = fnIdx;
    while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
    while (i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { i++; break; } } i++; }
    const body = src.slice(fnIdx, i);
    assert.ok(
        body.includes('System Settings') || body.includes('Privacy') && body.includes('Microphone'),
        'silent-track banner must contain Mac System Settings / Privacy & Security instruction'
    );
    assert.ok(
        body.includes('vacSilentTrackBanner'),
        'banner must use element id vacSilentTrackBanner'
    );
    assert.ok(
        body.includes('data-testid'),
        'banner must carry data-testid attribute for Playwright test targeting'
    );
});

test('SAGA-SILENT-06: silent-track detection uses _silentTrackFrames counter inside runAVFrame', () => {
    // The detection loop is the key: it counts frames, not a one-shot check.
    assert.ok(
        src.includes('_silentTrackFrames') && src.includes('SILENT_TRACK_DETECT_FRAMES'),
        '_silentTrackFrames counter and SILENT_TRACK_DETECT_FRAMES threshold must both be present'
    );
    // SILENT_TRACK_DETECT_FRAMES is used (compared against) inside runAVFrame.
    // Find runAVFrame body and verify the constant appears in it.
    const frameIdx = src.indexOf('function runAVFrame(');
    assert.ok(frameIdx >= 0, 'runAVFrame must be defined');
    // Extract body by brace-counting
    let depth = 0, i = frameIdx;
    while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
    while (i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { i++; break; } } i++; }
    const frameBody = src.slice(frameIdx, i);
    assert.ok(
        frameBody.includes('SILENT_TRACK_DETECT_FRAMES') && frameBody.includes('_silentTrackFrames'),
        'SILENT_TRACK_DETECT_FRAMES and _silentTrackFrames must be used inside runAVFrame body (detection loop)'
    );
});

test('SAGA-SILENT-06: SILENT_TRACK_RMS_THRESHOLD and SILENT_TRACK_SYNTH_THRESHOLD declared', () => {
    const rmsM   = src.match(/const\s+SILENT_TRACK_RMS_THRESHOLD\s*=\s*([\d.]+)/);
    const synthM = src.match(/const\s+SILENT_TRACK_SYNTH_THRESHOLD\s*=\s*([\d.]+)/);
    assert.ok(rmsM,   'SILENT_TRACK_RMS_THRESHOLD must be declared as a named const');
    assert.ok(synthM, 'SILENT_TRACK_SYNTH_THRESHOLD must be declared as a named const');
    const rmsVal   = parseFloat(rmsM[1]);
    const synthVal = parseFloat(synthM[1]);
    assert.ok(rmsVal   > 0   && rmsVal   < 0.05, `SILENT_TRACK_RMS_THRESHOLD=${rmsVal} must be in (0, 0.05) — just above codec noise (~0.003)`);
    assert.ok(synthVal > 0   && synthVal < 0.15, `SILENT_TRACK_SYNTH_THRESHOLD=${synthVal} must be in (0, 0.15) — below a quiet voice but above noise`);
    assert.ok(rmsVal < synthVal, 'SILENT_TRACK_RMS_THRESHOLD must be < SILENT_TRACK_SYNTH_THRESHOLD (silence threshold below synth proof threshold)');
});

test('SAGA-SILENT-06: silent_track_detected beaconed via vacDebug', () => {
    assert.ok(
        src.includes("vacDebug('silent_track_detected'"),
        "silent_track_detected must be beaconed — ceremony health dashboard can count occurrences"
    );
});

test('SAGA-SILENT-06: testability exports exposed on window (__vacShowSilentTrackBanner)', () => {
    assert.ok(
        src.includes('window.__vacShowSilentTrackBanner = _showSilentTrackBanner'),
        'window.__vacShowSilentTrackBanner must be exported for Playwright test injection'
    );
    assert.ok(
        src.includes('window.__vacRunSyntheticAudioSelfTest = _runSyntheticAudioSelfTest'),
        'window.__vacRunSyntheticAudioSelfTest must be exported for Playwright test injection'
    );
});

// ── SAGA-GREET-DEAD-07: Gate-dead vs mismatch (S161) ─────────────────────────
//
// Root: Rob's device (13 Aug 2026 ~12:30 UTC) — mic meter fully green while greeting
// refused ("can't hear"). Cause: Chrome SpeechRecognition opens its OWN mic capture;
// under macOS device contention it hears silence forever while the analyser proves
// sustained modulated voice. With _vadStarved=false, the escape multiplier stayed 2x
// — a normal greeting (~1x voiced evidence) timed out one condition short.
// Fix (S161): track whether ANY transcript arrived. Zero transcripts = gate-dead (device
// contention) → escape at 1.0x immediately. Transcripts present but mismatching = true
// wrong-content case → keep 2x. Server verdict remains content authority (security unchanged).

test('SAGA-GREET-DEAD-07: _phraseHasTranscript declared (gate-dead sensor)', () => {
    assert.ok(
        src.includes('_phraseHasTranscript'),
        '_phraseHasTranscript must be declared — S161 gate-dead sensor: tracks whether SR ' +
        'produced any transcript at all (zero = device contention, not content mismatch)'
    );
});

test('SAGA-GREET-DEAD-07: _startPhraseContentGate accepts onAnyTranscript callback', () => {
    assert.ok(
        src.includes('function _startPhraseContentGate(phraseTokens, onMatch, onFatal, onAnyTranscript)'),
        '_startPhraseContentGate must accept 4th param onAnyTranscript — S161: caller needs ' +
        'to know SR is alive and producing results (even non-matching ones)'
    );
});

test('SAGA-GREET-DEAD-07: onAnyTranscript called inside _startPhraseContentGate onresult', () => {
    const fnIdx = src.indexOf('function _startPhraseContentGate(');
    assert.ok(fnIdx >= 0, '_startPhraseContentGate must be defined');
    let depth = 0, i = fnIdx;
    while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
    while (i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { i++; break; } } i++; }
    const body = src.slice(fnIdx, i);
    assert.ok(
        body.includes('onAnyTranscript'),
        'onAnyTranscript must be called inside _startPhraseContentGate onresult — ' +
        'S161: fires on every SR result so caller can distinguish dead-gate from mismatch'
    );
});

test('SAGA-GREET-DEAD-07: gate-dead escape uses 1.0x multiplier (not 2x)', () => {
    // The key invariant: _phraseGateDead path uses multiplier 1.0, not 2.
    // The escape condition must reference _phraseGateDead and _escapeMultiplier (or equivalent).
    assert.ok(
        src.includes('_phraseGateDead') && src.includes('_escapeMultiplier'),
        '_phraseGateDead and _escapeMultiplier must both be present — S161: gate-dead uses ' +
        '1.0x escape threshold; mismatch (transcripts present) keeps 2x strictness'
    );
});

test('SAGA-GREET-DEAD-07: phrase_gate_dead_escape event emitted on gate-dead path', () => {
    assert.ok(
        src.includes("vacDebug('phrase_gate_dead_escape'"),
        "phrase_gate_dead_escape must be emitted via vacDebug — S161: distinct telemetry event " +
        "so Rob's telemetry can confirm the gate-dead path fired (vs nomatch_escape)"
    );
});

test('SAGA-GREET-DEAD-07: mismatch path still emits phrase_content_gate_nomatch_escape', () => {
    assert.ok(
        src.includes("vacDebug('phrase_content_gate_nomatch_escape'"),
        "phrase_content_gate_nomatch_escape must still be emitted for the mismatch path — " +
        "S161: only gate-dead gets the new event; wrong-content transcripts keep the existing one"
    );
});

test('SAGA-GREET-DEAD-07: _phraseHasTranscript set to true in _startPhraseContentGate callback', () => {
    // The call site must pass a function() { _phraseHasTranscript = true } as onAnyTranscript.
    assert.ok(
        src.includes('_phraseHasTranscript = true'),
        '_phraseHasTranscript = true must appear in the onAnyTranscript callback at the ' +
        '_startPhraseContentGate call site — S161: sets the gate-dead sensor on first SR result'
    );
});
