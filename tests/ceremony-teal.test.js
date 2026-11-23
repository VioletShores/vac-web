// CEREMONY-TEAL (S206; Rob, 23 Nov 2026): the ceremony's lead colour is brand teal, not purple.
// Colour values only: no markup, wording or logic changes. The --purple* variable NAMES remain
// (open pull requests touch the lines that use them); their values must be teal.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const files = { 'auth.html': read('auth.html'), 'vac-reauth-ceremony.js': read('vac-reauth-ceremony.js') };

const PURPLE = [/#6c5ce7/i, /#5a4bd1/i, /#7c5cfc/i, /#8b7cf7/i, /rgba\(108,\s*92,\s*231/i, /rgba\(124,\s*92,\s*252/i, /rgba\(139,\s*92,\s*246/i];

test('no purple value is left in the ceremony page or script', () => {
  for (const [name, src] of Object.entries(files)) for (const p of PURPLE) assert.ok(!p.test(src), `${name} still has ${p}`);
});

test('the lead-colour variables hold brand teal', () => {
  for (const [name, src] of Object.entries(files)) {
    assert.match(src, /--purple: #2DD4BF;/, name);
    assert.match(src, /--purple-bg: rgba\(45,212,191,0\.08\);/, name);
    assert.match(src, /--purple-border: rgba\(45,212,191,0\.25\);/, name);
  }
  assert.match(files['auth.html'], /--teal: #2DD4BF;/);
});

test('text on a filled teal button is dark, never white', () => {
  for (const [name, src] of Object.entries(files)) {
    assert.ok(!/background: var\(--purple\); color: #fff/.test(src), name);
    assert.ok(!/background:var\(--purple[^)]*\);color:#fff/.test(src), name);
    assert.match(src, /\.btn-primary \{[^}]*background: var\(--purple\); color: #06251F;/, name);
  }
  assert.ok(!/btn\.style\.background = 'var\(--purple\)';\s*btn\.style\.color = 'white'/.test(files['auth.html']));
});
