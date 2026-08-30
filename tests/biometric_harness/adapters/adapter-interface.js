'use strict';
// adapter-interface.js — F-1202/S179 biometric harness: MODEL MANIFEST + adapter contract
//
// Generalizes the vac-protocol/research/speaker-verification-eval adapter pattern
// (benchmark harness wraps a scoreable model behind one interface, gated by a
// manifest describing what it is) to vac-web's stage functions: a
// tests/biometric_harness/stages/*.js module IS the "model" here (today, a
// client-side heuristic gate; tomorrow, potentially a real embedding model), and
// createAdapter() refuses to wrap one without a MODEL MANIFEST matching
// manifest-schema.json. This is a hand-written validator, not a full JSON-Schema
// engine — it checks exactly what manifest-schema.json requires (this repo has no
// ajv/schema-validator dependency; see lib/mini-yaml.js's header for the same
// zero-dependency constraint). harness.test.js cross-checks this validator against
// manifest-schema.json's declared `required`/`enum` so the two can't silently
// drift apart.

const STAGES = ['mic_qualify', 'phrase_gate', 'digit_voice', 'face_embed', 'finger_gesture', 'speaker_verification'];
const REQUIRED_FIELDS = ['model_id', 'version', 'stage', 'adapter', 'provenance', 'thresholds'];

class ManifestError extends Error {}

// Throws ManifestError on any shape violation; returns nothing on success.
function validateManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') {
        throw new ManifestError('refused: no manifest provided (F-1202 requires a MODEL MANIFEST — see manifest-schema.json)');
    }
    for (const field of REQUIRED_FIELDS) {
        if (!(field in manifest)) throw new ManifestError(`refused: manifest missing required field "${field}"`);
    }
    if (typeof manifest.model_id !== 'string' || manifest.model_id.length === 0) {
        throw new ManifestError('refused: manifest.model_id must be a non-empty string');
    }
    if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
        throw new ManifestError('refused: manifest.version must be a non-empty string');
    }
    if (!STAGES.includes(manifest.stage)) {
        throw new ManifestError(`refused: manifest.stage "${manifest.stage}" is not one of ${JSON.stringify(STAGES)}`);
    }
    if (typeof manifest.adapter !== 'string' || manifest.adapter.length === 0) {
        throw new ManifestError('refused: manifest.adapter must be a non-empty string');
    }
    if (!manifest.provenance || typeof manifest.provenance !== 'object') {
        throw new ManifestError('refused: manifest.provenance must be an object with {source, note}');
    }
    if (!manifest.provenance.source || !manifest.provenance.note) {
        throw new ManifestError('refused: manifest.provenance requires both "source" and "note"');
    }
    if (!manifest.thresholds || typeof manifest.thresholds !== 'object' || Object.keys(manifest.thresholds).length === 0) {
        throw new ManifestError('refused: manifest.thresholds must be a non-empty object of named numeric thresholds');
    }
    for (const [k, v] of Object.entries(manifest.thresholds)) {
        if (typeof v !== 'number') throw new ManifestError(`refused: manifest.thresholds.${k} must be a number`);
    }
}

// stageModule: one of tests/biometric_harness/stages/*.js's module.exports
// (must expose {name, run(fixture)} and may expose {verifySource, constants}).
// Returns a BiometricAdapter: { manifest, stageName, score(fixture), verify() }.
function createAdapter({ manifest, stageModule }) {
    validateManifest(manifest);
    if (!stageModule || typeof stageModule.run !== 'function') {
        throw new ManifestError('refused: stageModule must expose run(fixture)');
    }
    if (manifest.stage !== stageModule.name) {
        throw new ManifestError(`refused: manifest.stage "${manifest.stage}" does not match stageModule.name "${stageModule.name}"`);
    }
    return {
        manifest,
        stageName: stageModule.name,
        score(fixture) { return stageModule.run(fixture); },
        verify() { if (typeof stageModule.verifySource === 'function') stageModule.verifySource(); },
    };
}

module.exports = { STAGES, REQUIRED_FIELDS, ManifestError, validateManifest, createAdapter };
