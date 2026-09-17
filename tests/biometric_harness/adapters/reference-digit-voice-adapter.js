'use strict';
// reference-digit-voice-adapter.js — F-1202/S179 biometric harness
//
// The ONE reference adapter for this slice (task brief: "one reference adapter
// wrapping the current speaker path"). vac-web has no trained speaker-embedding
// model — the current speaker-adjacent path is the digit-voice gate
// (stages/digit-voice.js), so that's what this reference wraps behind the
// BiometricAdapter contract (adapter-interface.js). A real speaker-verification
// model (tracked in vac-protocol/research/speaker-verification-eval) gets its own
// manifest + adapter later; this one demonstrates the contract works end to end
// and REFUSES to construct without a valid MODEL MANIFEST.

const fs = require('node:fs');
const path = require('node:path');
const { parseYaml } = require('../lib/mini-yaml');
const { createAdapter } = require('./adapter-interface');
const digitVoiceStage = require('../stages/digit-voice');

const DEFAULT_MANIFEST_PATH = path.join(__dirname, '..', '..', 'fixtures', 'biometric', 'model-manifest.example.yaml');

// manifest: a parsed manifest object, OR omitted to load the default example
// manifest from disk. Pass `null` explicitly to test the refusal path.
function loadReferenceAdapter(manifest) {
    let m = manifest;
    if (m === undefined) {
        m = parseYaml(fs.readFileSync(DEFAULT_MANIFEST_PATH, 'utf8'));
    }
    return createAdapter({ manifest: m, stageModule: digitVoiceStage }); // throws ManifestError if m is null/invalid
}

module.exports = { loadReferenceAdapter, DEFAULT_MANIFEST_PATH };
