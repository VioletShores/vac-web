// site-figures.test.js — vacprotocol.org public pages carry no hard-coded
// patent, claim or filing counts. Figures render at load from
// /data/company-facts.json (Athena Data); the HTML holds only data-fact keys.
//
// Run: node --test tests/site-figures.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// The public site (S204 rebuild) plus the pages its nav and buttons open.
const SITE_PAGES = [
  'index.html', 'protocol.html', 'specifications.html', 'try.html', 'developers.html',
  'vac-in-athena.html', 'ip.html', 'regulatory.html', 'contact.html',
  'auth.html', 'vat-verify.html', 'control-demo.html', 'demos.html', 'eu-ai-act.html', 'simulation.html',
];

const WORD_NUM = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
const FORBIDDEN = [
  { name: 'numeric patent/claim/filing count', re: /(?<![\w.])\d[\d,]*\s*\+?\s*(?:patent\s+|provisional\s+|IP\s+|Australian\s+patent\s+)?(?:claims?|filings?|patents?|patent\s+applications?)\b/i },
  { name: 'spelled-out claim/filing count', re: new RegExp('\\b' + WORD_NUM + '\\s+(?:patent\\s+|provisional\\s+|IP\\s+)?(?:claims|filings)\\b', 'i') },
  { name: 'claim range', re: /\bclaims?\s+\d+\s*(?:-|–|&ndash;|\\u2013)\s*\d+/i },
  { name: 'AU application number', re: /\bAU\s?20\d{2}\s?9\d{5}\b/ },
  { name: 'count label like "Claims · 17 Filings"', re: /\b\d[\d,]*\s*(?:Claims|Filings)\b/ },
];

// Fictional scenario text that is not a figure about VAC or Violet Shores.
const ALLOW = [
  'IP: 2 provisional patents, neither granted', // control-demo.html: the made-up "ACME AI" due-diligence agent output
];

function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

test('every site page exists', () => {
  for (const f of SITE_PAGES) assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' is missing');
});

for (const f of SITE_PAGES) {
  test(`${f}: no hard-coded patent, claim or filing count`, () => {
    let src = read(f);
    for (const a of ALLOW) src = src.split(a).join('');
    // Source comments are not shown to readers; strip them before scanning.
    src = src.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, '$1');
    src = src.replace(/&middot;|·/g, ' ').replace(/&nbsp;/g, ' ');
    for (const { name, re } of FORBIDDEN) {
      const m = src.match(re);
      assert.strictEqual(m, null, `${f}: ${name}: "${m && src.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20).replace(/\s+/g, ' ')}"`);
    }
  });
}

const NEW_PAGES = SITE_PAGES.slice(0, 9);
for (const f of NEW_PAGES) {
  test(`${f}: loads the facts renderer, and every patent figure says provisional / patent pending`, () => {
    const src = read(f);
    assert.ok(src.includes('<script src="/site/site.js"></script>'), f + ' does not load /site/site.js');
    const blocks = src.match(/<div class="stat"[^>]*>[\s\S]*?<\/div>/g) || [];
    for (const b of blocks) {
      if (/data-fact="patents\./.test(b)) assert.match(b, /provisional|patent pending/i, f + ': patent figure without "provisional / patent pending": ' + b);
    }
  });
}

test('every new page has a vercel.json rewrite, and athenapilot.ai is in nav and footer', () => {
  const v = JSON.parse(read('vercel.json'));
  const sources = new Set(v.rewrites.map((r) => r.source));
  for (const f of NEW_PAGES.filter((p) => p !== 'index.html')) {
    const route = '/' + f.replace(/\.html$/, '');
    assert.ok(sources.has(route), 'no rewrite for ' + route);
  }
  for (const f of NEW_PAGES) {
    const src = read(f);
    const nav = src.slice(src.indexOf('<header class="nav"'), src.indexOf('</header>'));
    const foot = src.slice(src.indexOf('<footer class="foot"'));
    assert.ok(nav.includes('href="https://athenapilot.ai"'), f + ': athenapilot.ai missing from the top menu');
    assert.ok(foot.includes('href="https://athenapilot.ai"'), f + ': athenapilot.ai missing from the footer');
  }
});

test('the facts snapshot, when present, has the registry shape', () => {
  const p = path.join(ROOT, 'data', 'company-facts.json');
  if (!fs.existsSync(p)) return; // pages degrade to "pending"; nothing to check
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.ok(j && typeof j.facts === 'object', 'facts object missing');
  for (const [k, f] of Object.entries(j.facts)) {
    assert.ok(f && 'value' in f && 'public' in f, k + ' lacks value/public');
  }
});
