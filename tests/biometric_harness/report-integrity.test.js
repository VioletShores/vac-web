'use strict';
// Report integrity only: these tests do not claim mirror parity or biometric accuracy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runHarness, loadManifest, STAGES } = require('./run');

const root = path.resolve(__dirname, '../..');
const singleDigit = () => ({ version: 1, specimens: [
    loadManifest().specimens.find(s => s.id === 'crisp_267ms_digit'),
] });

function driftedDigitReport(replace, cli = false) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vac-report-integrity-'));
    try {
        fs.cpSync(path.join(root, 'tests'), path.join(tmp, 'tests'), { recursive: true });
        for (const name of ['vac-reauth-ceremony.js', 'vac-face-embed.js', 'vac-finger-detect.js']) {
            fs.copyFileSync(path.join(root, name), path.join(tmp, name));
        }
        const p = path.join(tmp, 'vac-reauth-ceremony.js');
        const before = fs.readFileSync(p, 'utf8');
        const after = replace(before);
        assert.notEqual(after, before, 'negative case must alter the actual source');
        fs.writeFileSync(p, after);
        const script = `const r = require('./tests/biometric_harness/run');
            const m = { version: 1, specimens: [r.loadManifest().specimens.find(s => s.id === 'crisp_267ms_digit')] };
            console.log(JSON.stringify(r.runHarness(m)));`;
        if (cli) {
            const child = spawnSync(process.execPath, ['tests/biometric_harness/run.js'], { cwd: tmp, encoding: 'utf8' });
            return { status: child.status, output: child.stdout + child.stderr,
                report: JSON.parse(fs.readFileSync(path.join(tmp, 'tests/biometric_harness/reports/latest.json'), 'utf8')) };
        }
        const child = spawnSync(process.execPath, ['-e', script], { cwd: tmp, encoding: 'utf8' });
        assert.equal(child.status, 0, child.stderr);
        return JSON.parse(child.stdout);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function assertBindingError(report) {
    assert.equal(report.summary.match, 0);
    assert.equal(report.summary.error, report.summary.total);
    for (const result of report.results) {
        assert.equal(result.verdict, 'ERROR');
        assert.equal(result.errorKind, 'SOURCE_BINDING_ERROR');
        assert.equal(Object.hasOwn(result, 'pass'), false, 'unvalidated mirror must not be scored');
        assert.equal(Object.hasOwn(result, 'score'), false);
    }
}

test('report refuses an actual changed modulation threshold expression', () => {
    assertBindingError(driftedDigitReport(src => src.replaceAll(
        '(_vadStarved || (voiceMax - voiceMin) >= Math.max(0.012, 0.10 * voiceMax))',
        '(_vadStarved || (voiceMax - voiceMin) >= Math.max(0.012, 0.20 * voiceMax))')));
});

test('report refuses a removed elapsed-policy anchor', () => {
    assertBindingError(driftedDigitReport(src => src.replaceAll(
        '(_now - _voiceOnsetAt) >= DIGIT_VOICE_MIN_MS',
        '(_now - _voiceOnsetAt) >= 999')));
});

test('stage without source verifier cannot score even a passing fixture', () => {
    const original = STAGES.digit_voice;
    let called = false;
    STAGES.digit_voice = { run() { called = true; return { pass: true, score: 1, latencyMs: 0 }; } };
    try { assertBindingError(runHarness(singleDigit())); assert.equal(called, false); }
    finally { STAGES.digit_voice = original; }
});

test('valid unchanged digit source still produces a fixture match', () => {
    const report = runHarness(singleDigit());
    assert.equal(report.summary.match, 1);
    assert.equal(report.summary.error, 0);
});

test('all report matches have passed that stages existing source verifier', () => {
    const report = runHarness();
    const invalid = Object.entries(STAGES).filter(([, stage]) => {
        try { stage.verifySource(); return false; } catch { return true; }
    }).map(([name]) => name);
    const invalidResults = report.results.filter(r => invalid.includes(r.stage));
    // Do not pin a known bug forever: once adapters are genuinely reconciled,
    // this still requires every invalid stage, if any, to remain unscored.
    assertBindingError({ results: invalidResults, summary: {
        total: invalidResults.length,
        match: invalidResults.filter(r => r.verdict.startsWith('MATCH')).length,
        error: invalidResults.filter(r => r.verdict === 'ERROR').length,
    } });
});

test('CLI returns nonzero and writes invalid source evidence instead of clean success', () => {
    const child = driftedDigitReport(src => src.replaceAll(
        '(_now - _voiceOnsetAt) >= DIGIT_VOICE_MIN_MS',
        '(_now - _voiceOnsetAt) >= 999'), true);
    assert.equal(child.status, 1, child.output);
    const report = child.report;
    assert.ok(report.summary.error > 0);
    assert.ok(report.results.some(r => r.errorKind === 'SOURCE_BINDING_ERROR'));
    assert.ok(report.summary.match < report.summary.total);
});
