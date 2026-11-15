'use strict';
// mic-starved-fallback.test.js — s182 ceremony UX bundle: analyser_starved_mr_fallback fix harness
//
// WHAT THIS IS: the Node mirror tier for the mic fix directed by
// docs/strategic/CEREMONY-MIC-DIAGNOSIS-2026-08-20.md (athena repo). Same pattern as
// tests/mic-voiced-run.test.js: source-anchored constant/function extraction + a hand-written
// mirror of the two runAVFrame blocks that cannot be extracted (they live inside a closure):
//   (a) the task-724 starvation detector (level <= 1 for > 2s while ctx running) — now ALSO
//       rebuilds the analyser graph once per episode (s182 root fix), and
//   (b) the s182 fallback-path frame classifier feeding the SHARED _voicedRunTick/_voicedRunPass.
// The MediaRecorder blob-size proxy is mirrored from _startAvMrFallback's ondataavailable and
// anchored to source by regex.
//
// FAILING FIXTURE: on the pre-s182 classifier (analyser RMS only), the starved_then_speech
// fixture NEVER qualifies in 8s — the "several seconds of speaking before green" Rob reported.
// On the s182 classifier it qualifies within ~1.5s of the proxy starting.
//
// Run: node --test tests/mic-starved-fallback.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const F = require('./fixtures/mic-starved-analyser-fixtures');
const { rmsOfTdBuf } = require('./fixtures/mic-test-audio-fixtures');

const SRC_PATH = path.join(__dirname, '..', 'vac-reauth-ceremony.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

function constFromSource(name) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
    assert.ok(m, `expected "const ${name} = ...;" in source`);
    return Function('"use strict"; return (' + m[1] + ');')();
}
function extractFn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name + ' not found in source');
    let depth = 0, i = start;
    while (i < src.length && depth === 0) { if (src[i] === '{') depth++; i++; }
    while (i < src.length) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) { i++; break; } } i++; }
    return src.slice(start, i);
}

// ── shared predicate, extracted verbatim (NOT mirrored) ────────────────────────
const VOICED_RUN_TICKS_NEEDED = constFromSource('VOICED_RUN_TICKS_NEEDED');
const VOICED_RUN_MOD_DELTA = constFromSource('VOICED_RUN_MOD_DELTA');
const VOICED_RUN_SPEECH_RMS_FLOOR = constFromSource('VOICED_RUN_SPEECH_RMS_FLOOR');
const VOICED_RUN_SILENCE_RMS_FLOOR = constFromSource('VOICED_RUN_SILENCE_RMS_FLOOR');
const VOICE_BAND_MIN_RATIO = constFromSource('VOICE_BAND_MIN_RATIO');
const MR_FALLBACK_VOICED_LEVEL = constFromSource('MR_FALLBACK_VOICED_LEVEL');
const voiced = Function(
    `const VOICED_RUN_TICKS_NEEDED=${VOICED_RUN_TICKS_NEEDED}, VOICED_RUN_MOD_DELTA=${VOICED_RUN_MOD_DELTA};\n` +
    extractFn('_newVoicedRunState') + '\n' + extractFn('_voicedRunTick') + '\n' + extractFn('_voicedRunPass') +
    '\nreturn { _newVoicedRunState, _voicedRunTick, _voicedRunPass };'
)();

// ── mirrors of the in-closure blocks (anchored to source below) ────────────────
function frameLevelAndRatio(frame) {
    let maxDev = 0; for (let i = 0; i < frame.tdBuf.length; i++) { const d = Math.abs(frame.tdBuf[i] - 128); if (d > maxDev) maxDev = d; }
    const level = Math.min(100, Math.round((maxDev / 128) * 100));
    let band = 0, total = 0; for (let i = 0; i < frame.freqBuf.length; i++) { total += frame.freqBuf[i]; if (i >= 1 && i <= 16) band += frame.freqBuf[i]; }
    const meanBin = total / frame.freqBuf.length;
    const ratio = (meanBin >= 3) ? (band / total) : -1;
    return { level, ratio, rms: rmsOfTdBuf(frame.tdBuf) };
}
// _startAvMrFallback ondataavailable mirror: sliding 12-chunk window, warm-up 3 chunks / 5 in window.
function mrProxy() {
    let buf = [], count = 0, level = 0;
    return {
        push(sz) {
            if (!sz) return level;
            buf.push(sz); if (buf.length > 12) buf.shift(); count++;
            if (count < 3 || buf.length < 5) return level;
            const mn = Math.min.apply(null, buf), mx = Math.max.apply(null, buf);
            if (mn === 0) return level;
            level = Math.min(100, Math.max(0, Math.round(((mx / mn) - 1) / 3 * 100)));
            return level;
        },
        get level() { return level; },
    };
}
// s182 classifier mirror (runAVFrame mic block).
function classify(onFallback, mrLevel, ratio, rms) {
    const mrVoiced = onFallback && (mrLevel >= MR_FALLBACK_VOICED_LEVEL) && (ratio < 0 || ratio >= VOICE_BAND_MIN_RATIO);
    const voicedFrame = mrVoiced || ((ratio >= VOICE_BAND_MIN_RATIO) && (rms > VOICED_RUN_SPEECH_RMS_FLOOR));
    const silenceFrame = onFallback ? (mrLevel === 0 && !mrVoiced) : (rms < VOICED_RUN_SILENCE_RMS_FLOOR);
    return { voicedFrame, silenceFrame, runRms: mrVoiced ? (mrLevel / 100) : rms };
}
// Pre-s182 classifier (the failing reference).
function classifyLegacy(ratio, rms) {
    return { voicedFrame: (ratio >= VOICE_BAND_MIN_RATIO) && (rms > VOICED_RUN_SPEECH_RMS_FLOOR), silenceFrame: rms < VOICED_RUN_SILENCE_RMS_FLOOR, runRms: rms };
}

// Drives a fixture through the detector + classifier at 60fps; returns the pass time (ms) or null.
function simulate(fixture, opts) {
    const legacy = !!(opts && opts.legacy);
    const events = [];
    let deadSince = 0, fallback = false, rebuilt = 0, mrLevel = 0, chunkIdx = 0, nextChunkAt = null;
    const proxy = mrProxy();
    const state = voiced._newVoicedRunState();
    const seeded = 1500;   // GATE-343 f2 seed window
    const totalMs = fixture.seconds * 1000;
    for (let t = 0; t <= totalMs; t += F.FRAME_MS) {
        const fr = frameLevelAndRatio(fixture.frame(Math.floor(t / F.FRAME_MS)));
        let level = fr.level;
        // task-724 detector (+ s182 rebuild once)
        if (level <= 1) {
            if (deadSince === 0) deadSince = t;
            if (t - deadSince > 2000 && !fallback) {
                fallback = true; events.push({ t, e: 'analyser_starved_mr_fallback' });
                if (rebuilt === 0) { rebuilt++; events.push({ t, e: 'analyser_graph_rebuilt' }); }
                nextChunkAt = t + F.MR_CHUNK_MS;
            }
        } else if (level > 4) { deadSince = 0; if (fallback) { fallback = false; mrLevel = 0; } }
        if (fallback && nextChunkAt !== null && t >= nextChunkAt && chunkIdx < fixture.mrChunks.length) {
            mrLevel = proxy.push(fixture.mrChunks[chunkIdx++]); nextChunkAt += F.MR_CHUNK_MS;
        }
        if (fallback && mrLevel > 0) level = mrLevel;
        const onFallback = fallback && deadSince > 0;
        const c = legacy ? classifyLegacy(fr.ratio, fr.rms) : classify(onFallback, mrLevel, fr.ratio, fr.rms);
        voiced._voicedRunTick(state, c.runRms, c.voicedFrame, c.silenceFrame);
        if (t >= seeded && voiced._voicedRunPass(state, legacy ? false : onFallback)) {
            return { passAt: t, path: onFallback ? 'mr' : 'analyser', events, state };
        }
    }
    return { passAt: null, path: null, events, state };
}

// ── TC-MSF-01: the fixture IS the defect specimen ──────────────────────────────
test('TC-MSF-01: starved frames read as the telemetry described (level <= 1, rms ~0.004, spectrum neutral)', () => {
    const fr = frameLevelAndRatio(F.starvedFrame(0));
    assert.ok(fr.level <= 1, 'peak level must be <= 1% (starved)');
    assert.ok(fr.rms < VOICED_RUN_SILENCE_RMS_FLOOR, 'RMS must sit below the silence floor');
    assert.equal(fr.ratio, -1, 'FFT mean bin < 3 -> ratio neutral (t727 guard)');
});

test('TC-MSF-02: the fixture reproduces analyser_starved_mr_fallback after 2s and triggers exactly one graph rebuild', () => {
    const r = simulate(F.STARVED_FIXTURES.starved_silence);
    const fb = r.events.find(e => e.e === 'analyser_starved_mr_fallback');
    const rb = r.events.filter(e => e.e === 'analyser_graph_rebuilt');
    assert.ok(fb && fb.t > 2000 && fb.t < 2100, 'fallback starts just after 2s of confirmed starvation, got ' + (fb && fb.t));
    assert.equal(rb.length, 1, 'exactly one rebuild per starvation episode');
});

// ── TC-MSF-03: FAILING FIXTURE on the legacy classifier ────────────────────────
test('TC-MSF-03 [failing fixture]: pre-s182 classifier never greens the mic on starved frames + real speech (the felt defect)', () => {
    const r = simulate(F.STARVED_FIXTURES.starved_then_speech, { legacy: true });
    assert.equal(r.passAt, null, 'legacy analyser-only classifier must not pass in 8s — this is the defect');
});

// ── TC-MSF-04: s182 parity — fallback qualifies fast ───────────────────────────
test('TC-MSF-04: s182 fallback path qualifies the mic within 1.5s of the proxy starting, tagged path mr', () => {
    const r = simulate(F.STARVED_FIXTURES.starved_then_speech);
    const fb = r.events.find(e => e.e === 'analyser_starved_mr_fallback');
    assert.ok(r.passAt !== null, 'must qualify on the fallback path');
    assert.equal(r.path, 'mr');
    assert.ok(r.passAt - fb.t <= 1500, `must pass within 1.5s of the proxy starting (got ${Math.round(r.passAt - fb.t)}ms)`);
    assert.ok(r.passAt < 4000, `total time from mic-open under 4s (got ${Math.round(r.passAt)}ms)`);
});

test('TC-MSF-05: s182 fallback path does NOT green on starved silence', () => {
    const r = simulate(F.STARVED_FIXTURES.starved_silence);
    assert.equal(r.passAt, null);
    assert.equal(r.state.ticks, 0, 'silence chunks (proxy 0) decay the run');
});

test('TC-MSF-06 [documented property]: on the DEGRADED path a single transient can qualify for the proxy window — it is tagged mr and narrated, never silent', () => {
    const r = simulate(F.STARVED_FIXTURES.starved_door_slam);
    // The blob-size proxy is a peak/trough ratio over a 12-chunk window; one large slice keeps it
    // high for ~2.4s. The primary path rejects this (mic-voiced-run.test.js door_slam); the
    // fallback cannot see the spectrum. The mitigation is honesty: path 'mr' on the pass
    // telemetry + receipt (client_mic_path) and the on-screen "fallback path" label.
    assert.equal(r.path, r.passAt === null ? null : 'mr');
    assert.ok(/window\.__vacMicQualifyPath = _micOnFallback \? 'mr' : 'analyser'/.test(src), 'pass must record its path');
    assert.ok(/formData\.append\('client_mic_path', window\.__vacMicQualifyPath \|\| 'analyser'\)/.test(src), 'path must ride the verify upload for the receipt');
    assert.ok(/'Mic: working \(fallback path\)'/.test(src), 'a fallback-path pass is labelled as such');
});

// ── source anchors: the mirrors above track the shipped code ───────────────────
test('TC-MSF-07: MediaRecorder proxy mirror is anchored to _startAvMrFallback', () => {
    const body = extractFn('_startAvMrFallback');
    assert.ok(/_fbBuf\.length > 12\) _fbBuf\.shift\(\)/.test(body), 'window 12');
    assert.ok(/_fbChunkCount < 3 \|\| _fbBuf\.length < 5/.test(body), 'warm-up 3 / 5');
    assert.ok(/\(ratio - 1\) \/ 3 \* 100/.test(body), 'level formula');
    assert.ok(/_fbMr\.start\(200\)/.test(body), '200ms slices');
});

test('TC-MSF-08: runAVFrame starvation branch starts the proxy AND rebuilds the graph once (s182)', () => {
    const i = src.indexOf('if (_avNow - _avAnalyserDeadSince > 2000 && !_avMrFallback) {');
    assert.ok(i > 0, 'starvation branch present');
    const block = src.slice(i, i + 700);
    assert.ok(/_startAvMrFallback\(\);/.test(block), 'proxy starts');
    assert.ok(/if \(_avGraphRebuilt === 0\) \{ try \{ _rebuildAvAnalyserGraph\('starved'\); \}/.test(block), 'rebuild once per episode');
});

test('TC-MSF-09: _rebuildAvAnalyserGraph builds a POST-stream context on the original stream, pinned, and closes the old one', () => {
    const body = extractFn('_rebuildAvAnalyserGraph');
    assert.ok(/avAudioCtx = new \(window\.AudioContext \|\| window\.webkitAudioContext\)\(\)/.test(body), 'fresh context');
    assert.ok(/_pinSrc\(_originalStreamSource\(avAudioCtx, mediaStream\)\)\.connect\(avAnalyser\)/.test(body), 'task-733 original stream + SAGA-GC-01 pin');
    assert.ok(/avAnalyser\.fftSize = 256/.test(body), 'same analyser geometry (fixtures assume 256)');
    assert.ok(/_old\.close\(\)/.test(body), 'old (rate-mismatched) context is closed');
    assert.ok(/vacDebug\('analyser_graph_rebuilt'/.test(body), 'rebuild is a sensor (ctx_sr_before/after, track_sr)');
    assert.ok(/ctx_sr_before: _before, ctx_sr_after: avAudioCtx\.sampleRate, track_sr: _trackSr/.test(body));
});

test('TC-MSF-10: requestCamera rebuilds proactively when context and track sample rates disagree (the cold-grant case)', () => {
    const rc = extractFn('requestCamera');
    assert.ok(/_ctxSr && _trkSr && _ctxSr !== _trkSr\) _rebuildAvAnalyserGraph\('rate_mismatch'\)/.test(rc), 'rate-mismatch rebuild before startAVChecks');
    assert.ok(rc.indexOf("_rebuildAvAnalyserGraph('rate_mismatch')") < rc.indexOf('startAVChecks();'), 'runs before the pre-flight loop');
    // fixture semantics: mismatch -> rebuild, match -> no rebuild
    const decide = (fx) => !!(fx.ctxSampleRate && fx.trackSampleRate && fx.ctxSampleRate !== fx.trackSampleRate);
    assert.equal(decide(F.RATE_MISMATCH), true);
    assert.equal(decide(F.RATE_MATCH), false);
    assert.equal(decide({ ctxSampleRate: 48000, trackSampleRate: 0 }), false, 'unknown track rate -> no proactive rebuild (starvation detector still covers it)');
});

test('TC-MSF-11: the fallback classifier in source matches the mirror', () => {
    assert.ok(src.includes("const _mrVoicedFrame = _micOnFallback && (_avMrLevelSynth >= MR_FALLBACK_VOICED_LEVEL) && (_speechRatio < 0 || _speechRatio >= VOICE_BAND_MIN_RATIO);"));
    assert.ok(src.includes("const _micVoicedFrame = _mrVoicedFrame || ((_speechRatio >= VOICE_BAND_MIN_RATIO) && (_ceremonyRms > VOICED_RUN_SPEECH_RMS_FLOOR));"));
    assert.ok(src.includes("const _micSilenceFrame = _micOnFallback ? (_avMrLevelSynth === 0 && !_mrVoicedFrame) : (_ceremonyRms < VOICED_RUN_SILENCE_RMS_FLOOR);"));
    assert.ok(src.includes("_voicedRunTick(_micVoicedState, _mrVoicedFrame ? (_avMrLevelSynth / 100) : _ceremonyRms, _micVoicedFrame, _micSilenceFrame);"));
    assert.ok(src.includes("_voicedRunPass(_micVoicedState, _micOnFallback)"), 'modOverride on the proven proxy path');
    assert.ok(src.includes("const _micOnFallback = !!_avMrFallback && _avAnalyserDeadSince > 0;"));
    assert.ok(!/_avMrLevelSynth >= 8\b/.test(src.replace(/\/\/[^\n]*/g, '')), 'the literal 8 is hoisted into MR_FALLBACK_VOICED_LEVEL (code, not comments)');
    assert.equal(MR_FALLBACK_VOICED_LEVEL, 8, 'hoisted, not tuned');
});

test('TC-MSF-12: narration — "microphone starting" replaces a confident 0% while starved, and reverts when the analyser wakes', () => {
    assert.ok(src.includes("setAVStatus('mic', 'checking', 'Mic: starting, one moment');"));
    assert.ok(src.includes("'Microphone starting, one moment. Keep speaking normally.'"));
    assert.ok(/else if \(!_micOnFallback && _micFallbackNarrated\) \{[\s\S]{0,400}setAVStatus\('mic', 'checking', 'Mic'\);/.test(src), 'label reverts on recovery');
    assert.ok(/vacDebug\('mic_fallback_narrated'/.test(src), 'narration is itself a sensor');
    assert.ok(/mic_qualify_pending'[^\n]*path: _micOnFallback \? 'mr' : 'analyser', mr_level: _avMrLevelSynth, rebuilt: _avGraphRebuilt/.test(src), 'pending tick carries path/mr_level/rebuilt');
});

test('TC-MSF-13: §4c — no threshold changed', () => {
    assert.equal(VOICE_BAND_MIN_RATIO, 0.45);
    assert.equal(VOICED_RUN_SPEECH_RMS_FLOOR, 0.055);
    assert.equal(VOICED_RUN_SILENCE_RMS_FLOOR, 0.030);
    assert.equal(VOICED_RUN_TICKS_NEEDED, 7);
    assert.equal(VOICED_RUN_MOD_DELTA, 0.045);
    assert.equal(constFromSource('MIC_READY_CAL_MS'), 400);
    assert.ok(src.includes('_avNow - _avAnalyserDeadSince > 2000'), 'starvation confirmation window unchanged (2s)');
});

test('TC-MSF-14: resets — a fresh pre-flight entry may rebuild again and starts un-narrated', () => {
    const s1 = extractFn('startAVChecks');
    assert.ok(/_avGraphRebuilt = 0;/.test(s1) && /_micFallbackNarrated = false;/.test(s1) && /window\.__vacMicQualifyPath = null;/.test(s1));
    const s2 = extractFn('stopAVChecks');
    assert.ok(/_avGraphRebuilt = 0; _micFallbackNarrated = false;/.test(s2));
});
