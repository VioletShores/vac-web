'use strict';
// Fail-closed mutation checks for the S173/S167 intentional duration-floor pair.
// Runs the REAL auth-fork-guard Bash script on temporary copies of the shipped
// ceremony, never changing release source or invoking the browser/network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const realCeremony = fs.readFileSync(path.join(root, 'vac-reauth-ceremony.js'), 'utf8');
const realGuard = path.join(root, 'scripts', 'check-auth-single-path.sh');

function exercise(replace = null) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vac-auth-fork-'));
  try {
    let source = realCeremony;
    if (replace) {
      const [needle, next] = replace;
      assert.ok(source.includes(needle), 'missing mutation target: ' + needle);
      source = source.replace(needle, next);
      assert.notEqual(source, realCeremony, 'mutation must change a source constant');
    }
    fs.writeFileSync(path.join(temp, 'vac-reauth-ceremony.js'), source);
    fs.copyFileSync(realGuard, path.join(temp, 'check-auth-single-path.sh'));
    return spawnSync('bash', ['check-auth-single-path.sh'], {
      cwd: temp,
      encoding: 'utf8',
      timeout: 10000,
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('intentional full 200ms / fast 235ms pair remains a passing pinned baseline', () => {
  const result = exercise();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /auth single-path invariants: OK/);
});

for (const [name, needle, replacement] of [
  ['full raised to 235', 'const DIGIT_VOICE_MIN_MS = 200;', 'const DIGIT_VOICE_MIN_MS = 235;'],
  ['full lowered to 199', 'const DIGIT_VOICE_MIN_MS = 200;', 'const DIGIT_VOICE_MIN_MS = 199;'],
  ['fast lowered to 200', 'const FAST_DIGIT_VOICE_MIN_MS = 235;', 'const FAST_DIGIT_VOICE_MIN_MS = 200;'],
  ['fast raised to 236', 'const FAST_DIGIT_VOICE_MIN_MS = 235;', 'const FAST_DIGIT_VOICE_MIN_MS = 236;'],
]) {
  test('guard refuses unauthorized ' + name + ' even if both durations become equal', () => {
    const result = exercise([needle, replacement]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /FORK DRIFT: deliberate digit_voice full=200ms \/ fast=235ms/);
  });
}

test('other onset fork drift remains rejected', () => {
  const result = exercise(['const FAST_VAD_ONSET_SUSTAIN_MS = 180;', 'const FAST_VAD_ONSET_SUSTAIN_MS = 181;']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FORK DRIFT: VAD_ONSET_SUSTAIN_MS=180 vs FAST_VAD_ONSET_SUSTAIN_MS=181/);
});

test('other digit-gap fork drift remains rejected', () => {
  const result = exercise(['const FAST_DIGIT_VOICE_GAP_MS = 200;', 'const FAST_DIGIT_VOICE_GAP_MS = 201;']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FORK DRIFT: DIGIT_VOICE_GAP_MS=200 vs FAST_DIGIT_VOICE_GAP_MS=201/);
});
