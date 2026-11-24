'use strict';
// run.js — F-1202/S179 biometric harness orchestrator
//
// Generalizes tests/mic-voiced-run.test.js's single-stage fixture loop across all
// five stages: loads tests/fixtures/biometric/manifest.yaml (specimen metadata) +
// derived-features.js (specimen data), runs every specimen through every stage it
// names, and emits a JSON + markdown report. Used two ways:
//   - `node tests/biometric_harness/run.js` (CI, report-only — see
//     .github/workflows/biometric-harness.yml): writes reports/latest.{json,md}
//     and exits nonzero for invalid source bindings or fixture errors/mismatches.
//     The workflow still explicitly decides whether this is a blocking gate.
//   - required by harness.test.js, which DOES assert on the results (that's the
//     enforced gate — this file just runs and reports).

const fs = require('node:fs');
const path = require('node:path');
const { parseYaml } = require('./lib/mini-yaml');
const { DERIVED_FEATURES } = require('../fixtures/biometric/derived-features');

// Source extraction may fail while a stage module is loading. Preserve the
// error as an invalid binding in the report; never substitute a passing stage.
function loadStage(modulePath) {
    try { return require(modulePath); }
    catch (error) { return { verifySource() { throw error; } }; }
}

const STAGES = {
    mic_qualify: loadStage('./stages/mic-qualify'),
    phrase_gate: loadStage('./stages/phrase-gate'),
    digit_voice: loadStage('./stages/digit-voice'),
    face_embed: loadStage('./stages/face-embed'),
    finger_gesture: loadStage('./stages/finger-gesture'),
};

// mic_qualify/phrase_gate/digit_voice stages take a bare frames array; face_embed/
// finger_gesture take the fixture object itself (they need more than one field).
const STAGE_INPUT_EXTRACTORS = {
    mic_qualify: (data) => data.frames,
    phrase_gate: (data) => data.frames,
    digit_voice: (data) => data.frames,
    face_embed: (data) => data,
    finger_gesture: (data) => data,
};
// S207: per-specimen stage options (e.g. mic_qualify's frameMs / ambientRms for the
// voiced-time mic test). Absent -> the stage's own defaults, exactly as before.
const STAGE_OPTION_EXTRACTORS = {
    mic_qualify: (data) => data.options || {},
};

const MANIFEST_PATH = path.join(__dirname, '..', 'fixtures', 'biometric', 'manifest.yaml');
const REPORTS_DIR = path.join(__dirname, 'reports');

function loadManifest(manifestPath = MANIFEST_PATH) {
    return parseYaml(fs.readFileSync(manifestPath, 'utf8'));
}

function verdictFor(expectedOutcome, pass) {
    if (expectedOutcome === 'PASS') return pass ? 'MATCH' : 'MISMATCH';
    if (expectedOutcome === 'FAIL') return !pass ? 'MATCH' : 'MISMATCH';
    if (expectedOutcome === 'CLIENT_GATE_PASSES_SERVER_AUTHORITATIVE') return pass ? 'MATCH_TRUST_BOUNDARY' : 'MISMATCH';
    return 'UNKNOWN_EXPECTATION';
}

// Runs every specimen in `manifest` against every stage it names. Returns the
// report object; does not write anything to disk (see writeReport for that).
function runHarness(manifest = loadManifest()) {
    const results = [];
    const sourceBindings = new Map();
    for (const specimen of manifest.specimens) {
        const stageNames = Array.isArray(specimen.stage) ? specimen.stage : [specimen.stage];
        for (const stageName of stageNames) {
            if (!['PASS', 'FAIL', 'CLIENT_GATE_PASSES_SERVER_AUTHORITATIVE'].includes(specimen.expectedOutcome)) {
                results.push({ id: specimen.id, stage: stageName, verdict: 'ERROR',
                    errorKind: 'INVALID_EXPECTATION', error: `unknown expected outcome "${specimen.expectedOutcome}"` });
                continue;
            }
            const stageModule = STAGES[stageName];
            if (!stageModule) {
                results.push({ id: specimen.id, stage: stageName, error: `unknown stage "${stageName}"`, verdict: 'ERROR' });
                continue;
            }
            // Validate once per stage before any fixture uses its mirror. A
            // matching fixture from stale code is not evidence of shipped behavior.
            if (!sourceBindings.has(stageName)) {
                try {
                    if (typeof stageModule.verifySource !== 'function') {
                        throw new Error('stage has no source verifier');
                    }
                    stageModule.verifySource();
                    sourceBindings.set(stageName, { valid: true });
                } catch (e) {
                    sourceBindings.set(stageName, { valid: false, error: e.message || String(e) });
                }
            }
            const binding = sourceBindings.get(stageName);
            if (!binding.valid) {
                results.push({
                    id: specimen.id, stage: stageName, verdict: 'ERROR',
                    errorKind: 'SOURCE_BINDING_ERROR', error: binding.error,
                });
                continue;
            }
            const data = DERIVED_FEATURES[specimen.id] && DERIVED_FEATURES[specimen.id][stageName];
            if (!data) {
                results.push({ id: specimen.id, stage: stageName, error: 'no derived-feature data for this id/stage pair', verdict: 'ERROR' });
                continue;
            }
            try {
                const input = STAGE_INPUT_EXTRACTORS[stageName](data);
                const result = STAGE_OPTION_EXTRACTORS[stageName]
                    ? stageModule.run(input, STAGE_OPTION_EXTRACTORS[stageName](data))
                    : stageModule.run(input);
                results.push({
                    id: specimen.id,
                    stage: stageName,
                    expectedOutcome: specimen.expectedOutcome,
                    pass: result.pass,
                    score: result.score,
                    latencyMs: result.latencyMs,
                    detail: result.detail,
                    verdict: verdictFor(specimen.expectedOutcome, result.pass),
                });
            } catch (e) {
                results.push({ id: specimen.id, stage: stageName, error: e.message, verdict: 'ERROR' });
            }
        }
    }

    const summary = {
        total: results.length,
        match: results.filter((r) => r.verdict === 'MATCH' || r.verdict === 'MATCH_TRUST_BOUNDARY').length,
        mismatch: results.filter((r) => r.verdict === 'MISMATCH').length,
        error: results.filter((r) => r.verdict === 'ERROR').length,
    };

    return { manifestVersion: manifest.version, sourceBindings: Object.fromEntries(sourceBindings), results, summary };
}

function toMarkdown(report) {
    const lines = [];
    lines.push('# Biometric harness report (F-1202/S179)');
    lines.push('');
    lines.push(`Manifest version: ${report.manifestVersion}`);
    lines.push('');
    lines.push(`**${report.summary.match}/${report.summary.total} matched** their expected outcome (${report.summary.mismatch} mismatch, ${report.summary.error} error).`);
    lines.push('');
    lines.push('This job is report-only — a mismatch here does not block merge (see .github/workflows/biometric-harness.yml). It flags a drift between the fixture set\'s expectations and the stage mirrors for a human to look at.');
    lines.push('');
    lines.push('| id | stage | expected | pass | score | latency (ms) | verdict |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const r of report.results) {
        if (r.verdict === 'ERROR') {
            lines.push(`| ${r.id} | ${r.stage} | - | - | - | - | ERROR: ${r.error} |`);
            continue;
        }
        lines.push(`| ${r.id} | ${r.stage} | ${r.expectedOutcome} | ${r.pass} | ${typeof r.score === 'number' ? r.score.toFixed(3) : r.score} | ${r.latencyMs.toFixed(3)} | ${r.verdict} |`);
    }
    lines.push('');
    return lines.join('\n');
}

function writeReport(report, dir = REPORTS_DIR) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'latest.md'), toMarkdown(report));
}

function main() {
    const manifest = loadManifest();
    const report = runHarness(manifest);
    writeReport(report);
    console.log(`biometric harness: ${report.summary.match}/${report.summary.total} matched, ${report.summary.mismatch} mismatch, ${report.summary.error} error`);
    for (const r of report.results) {
        if (r.verdict === 'MISMATCH' || r.verdict === 'ERROR') {
            console.log(`  ! ${r.id}/${r.stage}: ${r.verdict}${r.error ? ' - ' + r.error : ''}`);
        }
    }
    // An invalid report must not look successful to CLI consumers. The existing
    // report-only workflow keeps its own continue-on-error policy unchanged.
    process.exitCode = report.summary.error || report.summary.mismatch ? 1 : 0;
}

module.exports = { loadManifest, runHarness, toMarkdown, writeReport, STAGES, STAGE_INPUT_EXTRACTORS, MANIFEST_PATH };

if (require.main === module) main();
