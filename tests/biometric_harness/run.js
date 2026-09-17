'use strict';
// run.js — F-1202/S179 biometric harness orchestrator
//
// Generalizes tests/mic-voiced-run.test.js's single-stage fixture loop across all
// five stages: loads tests/fixtures/biometric/manifest.yaml (specimen metadata) +
// derived-features.js (specimen data), runs every specimen through every stage it
// names, and emits a JSON + markdown report. Used two ways:
//   - `node tests/biometric_harness/run.js` (CI, report-only — see
//     .github/workflows/biometric-harness.yml): writes reports/latest.{json,md}
//     and ALWAYS exits 0; mismatches are recorded in the report, not enforced.
//   - required by harness.test.js, which DOES assert on the results (that's the
//     enforced gate — this file just runs and reports).

const fs = require('node:fs');
const path = require('node:path');
const { parseYaml } = require('./lib/mini-yaml');
const { DERIVED_FEATURES } = require('../fixtures/biometric/derived-features');

const STAGES = {
    mic_qualify: require('./stages/mic-qualify'),
    phrase_gate: require('./stages/phrase-gate'),
    digit_voice: require('./stages/digit-voice'),
    face_embed: require('./stages/face-embed'),
    finger_gesture: require('./stages/finger-gesture'),
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
    for (const specimen of manifest.specimens) {
        const stageNames = Array.isArray(specimen.stage) ? specimen.stage : [specimen.stage];
        for (const stageName of stageNames) {
            const stageModule = STAGES[stageName];
            if (!stageModule) {
                results.push({ id: specimen.id, stage: stageName, error: `unknown stage "${stageName}"`, verdict: 'ERROR' });
                continue;
            }
            const data = DERIVED_FEATURES[specimen.id] && DERIVED_FEATURES[specimen.id][stageName];
            if (!data) {
                results.push({ id: specimen.id, stage: stageName, error: 'no derived-feature data for this id/stage pair', verdict: 'ERROR' });
                continue;
            }
            try {
                const input = STAGE_INPUT_EXTRACTORS[stageName](data);
                const result = stageModule.run(input);
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

    return { manifestVersion: manifest.version, results, summary };
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
    // Report-only: never fails CI on its own (see module header).
    process.exitCode = 0;
}

module.exports = { loadManifest, runHarness, toMarkdown, writeReport, STAGES, STAGE_INPUT_EXTRACTORS, MANIFEST_PATH };

if (require.main === module) main();
