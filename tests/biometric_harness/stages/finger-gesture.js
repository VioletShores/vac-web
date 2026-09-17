'use strict';
// finger-gesture.js — F-1202/S179 biometric harness: finger/gesture stage
//
// Unlike the audio-gate stages (mic-qualify/phrase-gate/digit-voice), which mirror
// vac-reauth-ceremony.js's inline logic because it needs a live AudioContext,
// vac-finger-detect.js's counting math (countDetailed/countFingers/angle) and its
// F-613 hysteresis filter (detectStable/feedStable) are STATELESS pure functions
// over a landmark array — they need no DOM/network, so this stage loads and
// EXECUTES the real shipped module (window.FingerDetector) in Node behind a
// minimal window/vacDebug/performance shim, rather than mirroring it. This is the
// strongest-fidelity stage in the harness: a regression in the live counting/
// hysteresis math fails this test directly, no hand-copied predicate to drift.

const vm = require('node:vm');
const { FINGER_DETECT_SRC_PATH, readSrc } = require('../lib/source-anchor');

// Read once at module load — loadFingerDetector() still gets a FRESH vm context per
// call (needed: FingerDetector's hysteresis state is module-scoped inside the
// sandbox, and each run() needs a clean session), but re-reading the same file off
// disk on every call would be pure waste.
const src = readSrc(FINGER_DETECT_SRC_PATH);

function loadFingerDetector() {
    const sandboxWindow = {};
    const sandbox = {
        window: sandboxWindow,
        vacDebug: function () {},
        performance: { now: () => 0 },
        console,
    };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: FINGER_DETECT_SRC_PATH });
    if (!sandboxWindow.FingerDetector) throw new Error('finger-gesture stage: vac-finger-detect.js did not define window.FingerDetector — source has diverged');
    return sandboxWindow.FingerDetector;
}

function verifySource() {
    loadFingerDetector(); // throws if the module shape changed
}

// fixture: { frames: [landmarks21], expectedCount: number }
// A single-frame fixture reports raw geometry only (hysteresis needs >=4 frames to
// settle, per HYST_SETTLE_FRAMES); multi-frame fixtures also report the smoothed
// (hysteresis-filtered) final count, run in its own fresh session per call.
function run(fixture) {
    const t0 = process.hrtime.bigint();
    const FingerDetector = loadFingerDetector(); // fresh module instance -> fresh hysteresis state per run
    const rawCounts = fixture.frames.map((lm) => FingerDetector.countFingers(lm));
    const stableCounts = rawCounts.map((raw) => FingerDetector.feedStable(raw));
    const finalRaw = rawCounts[rawCounts.length - 1];
    const finalStable = stableCounts[stableCounts.length - 1];
    // For a single-frame fixture the hysteresis session hasn't settled — grade on raw geometry.
    const graded = fixture.frames.length > 1 ? finalStable : finalRaw;
    const pass = graded === fixture.expectedCount;
    const latencyMs = Number(process.hrtime.bigint() - t0) / 1e6;
    return {
        pass,
        score: pass ? 1 : 0,
        latencyMs,
        detail: { rawCounts, stableCounts, finalRaw, finalStable, graded, expectedCount: fixture.expectedCount },
    };
}

module.exports = { name: 'finger_gesture', verifySource, run };
