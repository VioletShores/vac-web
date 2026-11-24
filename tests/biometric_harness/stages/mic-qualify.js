'use strict';
// Execute the shipped tracker and preflight classifier, with synthetic audio.
// No browser/recorder/provider or server identity verdict is exercised here.
//
// S207: the mic test passes on VOICED TIME (MIC_VOICED_MS_NEEDED), with a near-field gate
// relative to the room's seeded ambient (_micNearFieldGate, capped at the old fixed floor).
// Frames carry no timestamps, so run() replays them on a virtual clock (options.frameMs,
// default one 60 Hz frame) and options.ambientRms stands in for the seeded room ambient.
const vm = require('node:vm');
const { CEREMONY_SRC_PATH, readSrc, constFromSource, requireIncludes, functionFromSource, declarationFromSource } = require('../lib/source-anchor');
const src = readSrc(CEREMONY_SRC_PATH);
const names = ['VOICED_RUN_TICKS_NEEDED', 'MIC_PREFLIGHT_TICKS_NEEDED', 'VOICED_RUN_MOD_DELTA', 'VOICED_RUN_SPEECH_RMS_FLOOR', 'VOICED_RUN_SILENCE_RMS_FLOOR', 'VOICE_BAND_MIN_RATIO', 'VOICE_BAND_STRONG_RATIO', 'MR_FALLBACK_VOICED_LEVEL'];
// Tunable (window.VAC_CEREMONY_TUNING) values: their shipped DEFAULT is read from the
// _vacTune(...) call; the harness has no window, so _vacTune returns that default.
const tuned = ['MIC_VOICED_MS_NEEDED', 'MIC_RMS_FLOOR', 'MIC_AMBIENT_MULT'];
function tunedDefault(source, name) {
    const m = source.match(new RegExp('const\\s+' + name + "\\s*=\\s*_vacTune\\('\\w+',\\s*([0-9.]+),\\s*([0-9.]+),\\s*([0-9.]+)\\);"));
    if (!m) throw new Error(`expected "const ${name} = _vacTune(...)" in the ceremony source`);
    return { value: Number(m[1]), min: Number(m[2]), max: Number(m[3]) };
}
function getConstants() {
    const out = Object.fromEntries(names.map(n => [n, constFromSource(src, n)]));
    for (const n of tuned) out[n] = tunedDefault(src, n).value;
    return out;
}
const fns = ['_newVoicedRunState', '_voicedRunTick', '_voicedRunPass', '_vacTune', '_micVoicedMsTick', '_micNearFieldGate', '_micPreflightPass'];
function trackerSource(source) {
    return names.map(n => declarationFromSource(source, n, 0)).join('\n') + '\n' +
        tuned.map(n => declarationFromSource(source, n, 0)).join('\n') + '\n' +
        fns.map(n => functionFromSource(source, n)).join('\n');
}
function compile(source = src) {
    requireIncludes(source, '_micVoicedState = _newVoicedRunState(MIC_PREFLIGHT_TICKS_NEEDED);');
    const tick = '_voicedRunTick(_micVoicedState, _mrVoicedFrame ? (_avMrLevelSynth / 100) : _ceremonyRms, _micVoicedFrame, _micSilenceFrame);';
    requireIncludes(source, tick);
    const msTick = '_micVoicedMsTick(_micVoicedState, _nowT, _micVoicedFrame, _micSilenceFrame);';
    requireIncludes(source, msTick);
    requireIncludes(source, 'if (_micSeeded && _micPreflightPass(_micVoicedState, _micOnFallback))');
    if ((source.match(/avChecks\.mic\s*=\s*true/g) || []).length !== 1) throw new Error('expected one mic success assignment');
    const signalStart = '            let _speechRatio = 0;';
    const signalEnd = '            _ceremonyRms = Math.sqrt(_ceremonyRms / dataArray.length) / 128;';
    if (source.split(signalStart).length !== 2 || source.split(signalEnd).length !== 2) throw new Error('ambiguous mic signal extraction');
    const start = source.indexOf(signalStart), end = source.indexOf(signalEnd);
    if (end <= start) throw new Error('invalid mic signal extraction order');
    const signal = source.slice(start, end + signalEnd.length);
    return vm.runInNewContext(trackerSource(source) + `\n({
        newState: _newVoicedRunState, tick: _voicedRunTick, pass: _voicedRunPass,
        msTick: _micVoicedMsTick, nearFieldGate: _micNearFieldGate, preflightPass: _micPreflightPass,
        preflightState: () => _newVoicedRunState(MIC_PREFLIGHT_TICKS_NEEDED),
        frame: function(_micVoicedState, dataArray, _fbuf, _micOnFallback, _avMrLevelSynth, _micSeeded, _nowT, _micSeededAmbientRms) {
            ${signal}
            ${['_mrVoicedFrame', '_micVoicedFrame', '_micSilenceFrame'].map(n => declarationFromSource(source, n)).join('\n')}
            ${tick}
            ${msTick}
            return _micSeeded && _micPreflightPass(_micVoicedState, _micOnFallback);
        }
    })`);
}
function verifySource() { compile(); }
function run(frames, options = {}) {
    // Old boolean override was not a real preflight context. Never bypass modulation
    // without explicitly exercising the recorder-fallback classifier.
    if (typeof options !== 'object' || options === null) throw new Error('mic requires explicit context options');
    const frameMs = options.frameMs === undefined ? 1000 / 60 : options.frameMs;
    const ambient = options.ambientRms || 0;
    const t0 = process.hrtime.bigint(), gate = compile(options.source || src), state = gate.preflightState();
    let passedAtFrame = null, passedAtMs = null, nowT = 1000;
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        nowT += frameMs;
        if (gate.frame(state, f.tdBuf, f.freqBuf, !!options.fallback, f.recorderLevel || 0, options.seeded !== false, nowT, ambient)) {
            passedAtFrame = i; passedAtMs = Math.round((i + 1) * frameMs); break;
        }
    }
    const pass = passedAtFrame !== null;
    return { pass, score: pass ? 1 : 0, latencyMs: Number(process.hrtime.bigint() - t0) / 1e6,
        detail: { passedAtFrame, passedAtMs, voicedMs: Math.round(state.ms || 0), finalTicks: state.ticks,
                  finalMod: +(state.max - state.min).toFixed(4), gate: +gate.nearFieldGate(ambient).toFixed(4) } };
}
module.exports = { name: 'mic_qualify', verifySource, run, compile, trackerSource, tunedDefault, get constants() { return getConstants(); },
    newVoicedRunState: (...args) => compile().newState(...args),
    voicedRunTick: (...args) => compile().tick(...args), voicedRunPass: (...args) => compile().pass(...args) };
