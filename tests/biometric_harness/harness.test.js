'use strict';
// harness.test.js — F-1202/S179 biometric harness self-tests
//
// Tests the HARNESS itself (parser, stage mirrors' source-anchoring, adapter
// refusal contract, orchestrator), not a specific product feature — the biometric
// stage regression coverage lives in the per-fixture verdicts this file asserts on.
// Unlike run.js's CI usage (report-only, see .github/workflows/biometric-harness.yml),
// `node --test` on this file is a real gate: a stage mirror that has silently
// drifted from vac-reauth-ceremony.js/vac-face-embed.js/vac-finger-detect.js, or a
// fixture that flips its expected outcome, fails this suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseYaml } = require('./lib/mini-yaml');
const { runHarness, loadManifest, toMarkdown, STAGES } = require('./run');
const { validateManifest, createAdapter, ManifestError, REQUIRED_FIELDS } = require('./adapters/adapter-interface');
const { loadReferenceAdapter, DEFAULT_MANIFEST_PATH } = require('./adapters/reference-digit-voice-adapter');
const digitVoiceStage = require('./stages/digit-voice');
const schema = require('./manifest-schema.json');

// ── mini-yaml ────────────────────────────────────────────────────────────────

test('mini-yaml: parses nested maps, folded scalars, flow lists and list-of-maps', () => {
    const doc = parseYaml([
        'a: 1',
        'b: true',
        'nested:',
        '  x: hello',
        '  y: >',
        '    line one',
        '    line two',
        'flow: [one, two, three]',
        'items:',
        '  - id: first',
        '    n: 1',
        '  - id: second',
        '    n: 2',
    ].join('\n'));
    assert.equal(doc.a, 1);
    assert.equal(doc.b, true);
    assert.equal(doc.nested.x, 'hello');
    assert.equal(doc.nested.y, 'line one line two');
    assert.deepEqual(doc.flow, ['one', 'two', 'three']);
    assert.equal(doc.items.length, 2);
    assert.equal(doc.items[0].id, 'first');
    assert.equal(doc.items[1].n, 2);
});

test('mini-yaml: parses the real manifest.yaml without throwing', () => {
    const manifest = loadManifest();
    assert.equal(manifest.version, 1);
    assert.ok(Array.isArray(manifest.specimens));
    assert.ok(manifest.specimens.length >= 10, 'expected at least the 10 documented specimens');
    for (const s of manifest.specimens) {
        assert.ok(s.id, 'every specimen needs an id');
        assert.ok(s.stage, `${s.id} needs a stage`);
        assert.ok(s.expectedOutcome, `${s.id} needs an expectedOutcome`);
        assert.ok(s.description && s.description.length > 10, `${s.id} needs a real description`);
    }
});

// ── stage source-anchoring (regression guard against vac-*.js drift) ─────────

for (const [name, stageModule] of Object.entries(STAGES)) {
    test(`stage ${name}: verifySource does not throw (mirror matches shipped source)`, () => {
        assert.doesNotThrow(() => stageModule.verifySource());
    });
}

// ── orchestrator: every manifest specimen resolves and matches its expectation ─

test('run.js: every manifest specimen×stage combination matches its expectedOutcome', () => {
    const report = runHarness();
    assert.equal(report.summary.error, 0, `expected 0 errors, got: ${JSON.stringify(report.results.filter((r) => r.verdict === 'ERROR'))}`);
    assert.equal(report.summary.mismatch, 0, `expected 0 mismatches, got: ${JSON.stringify(report.results.filter((r) => r.verdict === 'MISMATCH'))}`);
    assert.equal(report.summary.total, report.summary.match);
});

test('run.js: toMarkdown renders a table row per result', () => {
    const report = runHarness();
    const md = toMarkdown(report);
    assert.ok(md.includes('# Biometric harness report'));
    for (const r of report.results) assert.ok(md.includes(r.id), `markdown report missing row for ${r.id}`);
});

// ── adapter-interface: manifest-schema.json and the hand-written validator must agree ─

test('adapter-interface: REQUIRED_FIELDS matches manifest-schema.json "required"', () => {
    assert.deepEqual([...REQUIRED_FIELDS].sort(), [...schema.required].sort());
});

test('adapter-interface: STAGES matches manifest-schema.json stage.enum', () => {
    const { STAGES } = require('./adapters/adapter-interface');
    assert.deepEqual([...STAGES].sort(), [...schema.properties.stage.enum].sort());
});

test('adapter-interface: validateManifest checks the same provenance sub-fields manifest-schema.json requires', () => {
    assert.deepEqual([...schema.properties.provenance.required].sort(), ['note', 'source']);
    const missingSource = {
        model_id: 'x', version: '1', stage: 'digit_voice', adapter: 'y.js',
        provenance: { note: 'n' }, thresholds: { a: 1 },
    };
    assert.throws(() => validateManifest(missingSource), ManifestError);
    const missingNote = {
        model_id: 'x', version: '1', stage: 'digit_voice', adapter: 'y.js',
        provenance: { source: 's' }, thresholds: { a: 1 },
    };
    assert.throws(() => validateManifest(missingNote), ManifestError);
});

test('adapter-interface: refuses with no manifest', () => {
    assert.throws(() => validateManifest(undefined), ManifestError);
    assert.throws(() => validateManifest(null), ManifestError);
});

test('adapter-interface: refuses a manifest missing a required field', () => {
    const base = {
        model_id: 'x', version: '1', stage: 'digit_voice', adapter: 'y.js',
        provenance: { source: 's', note: 'n' }, thresholds: { a: 1 },
    };
    for (const field of REQUIRED_FIELDS) {
        const broken = { ...base };
        delete broken[field];
        assert.throws(() => validateManifest(broken), ManifestError, `should refuse without "${field}"`);
    }
});

test('adapter-interface: refuses an unknown stage', () => {
    const bad = {
        model_id: 'x', version: '1', stage: 'not_a_real_stage', adapter: 'y.js',
        provenance: { source: 's', note: 'n' }, thresholds: { a: 1 },
    };
    assert.throws(() => validateManifest(bad), ManifestError);
});

test('adapter-interface: createAdapter refuses when manifest.stage does not match the wrapped stage module', () => {
    const mismatched = {
        model_id: 'x', version: '1', stage: 'face_embed', adapter: 'y.js',
        provenance: { source: 's', note: 'n' }, thresholds: { a: 1 },
    };
    assert.throws(() => createAdapter({ manifest: mismatched, stageModule: digitVoiceStage }), ManifestError);
});

test('adapter-interface: accepts a well-formed manifest and scores fixtures', () => {
    const good = {
        model_id: 'x', version: '1', stage: 'digit_voice', adapter: 'y.js',
        provenance: { source: 's', note: 'n' }, thresholds: { a: 1 },
    };
    const adapter = createAdapter({ manifest: good, stageModule: digitVoiceStage });
    assert.doesNotThrow(() => adapter.verify());
    const { DERIVED_FEATURES } = require('../fixtures/biometric/derived-features');
    const result = adapter.score(DERIVED_FEATURES.crisp_267ms_digit.digit_voice.frames);
    assert.equal(result.pass, true);
});

// ── reference adapter (F-1202) ────────────────────────────────────────────────

test('reference-digit-voice-adapter: loads the checked-in example manifest and validates', () => {
    assert.ok(fs.existsSync(DEFAULT_MANIFEST_PATH), 'model-manifest.example.yaml must exist');
    const adapter = loadReferenceAdapter();
    assert.equal(adapter.stageName, 'digit_voice');
    assert.doesNotThrow(() => adapter.verify());
});

test('reference-digit-voice-adapter: refuses when explicitly given no manifest', () => {
    assert.throws(() => loadReferenceAdapter(null), ManifestError);
});

test('model-manifest.example.yaml satisfies manifest-schema.json required fields', () => {
    const manifest = parseYaml(fs.readFileSync(DEFAULT_MANIFEST_PATH, 'utf8'));
    for (const field of schema.required) {
        assert.ok(field in manifest, `example manifest missing required field "${field}"`);
    }
    assert.ok(schema.properties.stage.enum.includes(manifest.stage));
});

// ── fixture coverage: every stage named in the manifest has derived-feature data ─

test('every manifest specimen×stage pair has matching derived-feature data', () => {
    const manifest = loadManifest();
    const { DERIVED_FEATURES } = require('../fixtures/biometric/derived-features');
    for (const s of manifest.specimens) {
        const stages = Array.isArray(s.stage) ? s.stage : [s.stage];
        for (const stage of stages) {
            assert.ok(DERIVED_FEATURES[s.id], `no derived-features entry for specimen "${s.id}"`);
            assert.ok(DERIVED_FEATURES[s.id][stage], `no derived-features["${s.id}"]["${stage}"] data`);
        }
    }
});
