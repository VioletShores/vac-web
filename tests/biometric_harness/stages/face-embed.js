'use strict';
// face-embed.js — F-1202/S179 biometric harness: face-identity embedding stage
//
// vac-face-embed.js's compute() needs a real browser (dynamic import of a CDN ESM
// bundle + WebGL/wasm TFJS backend + camera frame) — not something this harness can
// run headlessly. Its distance math (euclidean()) and contract constants
// (EXPECTED_DIM, MODEL_ID) ARE pure and available the instant the module loads, so
// this stage loads the real shipped module (like finger-gesture.js) and exercises
// euclidean() against synthetic genuine/impostor embedding pairs — it does NOT call
// compute()/ready(), so it never touches the network.
//
// THRESHOLD: vac-face-embed.js's header docblock documents "LFW 99.38% @ euclidean
// 0.6" as the calibrated genuine/impostor boundary; the actual accept/reject
// decision is made SERVER-SIDE (that file's TRUST BOUNDARY comment) — this stage
// mirrors the documented threshold for grading fixtures only, it is not a claim
// that the client enforces it.

const vm = require('node:vm');
const { FACE_EMBED_SRC_PATH, readSrc, requireIncludes } = require('../lib/source-anchor');

const DISTANCE_THRESHOLD = 0.6;

const src = readSrc(FACE_EMBED_SRC_PATH);

// VACFaceEmbed's euclidean()/reasonMessage()/constants are fully stateless (no
// per-call session to isolate, unlike finger-gesture.js's hysteresis filter), so
// load it once at module scope rather than re-running the vm per call.
function loadFaceEmbed() {
    const sandboxWindow = {};
    const sandbox = { window: sandboxWindow, console };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: FACE_EMBED_SRC_PATH });
    if (!sandboxWindow.VACFaceEmbed) throw new Error('face-embed stage: vac-face-embed.js did not define window.VACFaceEmbed — source has diverged');
    return sandboxWindow.VACFaceEmbed;
}
const VACFaceEmbed = loadFaceEmbed();

function verifySource() {
    requireIncludes(src, 'LFW 99.38% @ euclidean 0.6',
        'face-embed stage: the documented LFW/euclidean-0.6 threshold text is gone — DISTANCE_THRESHOLD may be stale, source has diverged');
    requireIncludes(src, 'TRUST BOUNDARY: this only COMPUTES and returns the vector.',
        'face-embed stage: TRUST BOUNDARY comment is gone — re-check that the harness still correctly treats this as a client-only distance check, not the real decision');
}

// fixture: { pair: [embeddingA(128), embeddingB(128)] }, expectedOutcome PASS means
// "same identity" (distance < threshold), FAIL means "different identity" (>= threshold).
function run(fixture) {
    const t0 = process.hrtime.bigint();
    const [a, b] = fixture.pair;
    if (a.length !== VACFaceEmbed.EXPECTED_DIM || b.length !== VACFaceEmbed.EXPECTED_DIM) {
        throw new Error(`face-embed stage: fixture pair dimension mismatch (expected ${VACFaceEmbed.EXPECTED_DIM})`);
    }
    const distance = VACFaceEmbed.euclidean(a, b);
    const sameIdentity = distance !== null && distance < DISTANCE_THRESHOLD;
    const latencyMs = Number(process.hrtime.bigint() - t0) / 1e6;
    return {
        pass: sameIdentity,
        score: distance === null ? 0 : Math.max(0, 1 - distance / DISTANCE_THRESHOLD),
        latencyMs,
        detail: { distance, threshold: DISTANCE_THRESHOLD, modelId: VACFaceEmbed.MODEL_ID },
    };
}

module.exports = { name: 'face_embed', verifySource, run, DISTANCE_THRESHOLD };
