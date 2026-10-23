'use strict';
// vat-verify-escape.test.js — PKT-S201-VACWEB-VERIFY-ESCAPE: the public verify page must
// never turn untrusted values (API responses, the token header, the URL) into markup.
//
// Two checks, no dependencies:
//  1. the escaping helpers behave (text and quoted-attribute escaping, link scheme
//     allow-list, numeric coercion, class allow-list);
//  2. every ${...} interpolation in every inline script on the page is either a complete
//     helper call or is on the reviewed SAFE / STRUCTURAL lists below, matched exactly (static
//     text, numbers derived on the page, or markup assembled from already-escaped pieces). A
//     new raw interpolation, or any edit to a reviewed one, fails here.
//
// Run: node --test tests/vat-verify-escape.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'vat-verify.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const main = scripts.find(s => s.includes('function render(')) || '';
const allScripts = scripts.join('\n;\n');

function extractFn(name) {
    const start = main.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name + ' not found in vat-verify.html');
    let i = main.indexOf('{', start), depth = 0;
    for (; i < main.length; i++) {
        if (main[i] === '{') depth++;
        else if (main[i] === '}' && --depth === 0) { i++; break; }
    }
    return main.slice(start, i);
}

const helpers = Function(
    extractFn('escHtml') + '\n' + extractFn('safeNum') + '\n' + extractFn('safeHref') + '\n' +
    (main.match(/const CHAIN_STATUS_CLASSES = [^;]+;/) || [''])[0] + '\n' + extractFn('chainStatusClass') +
    '\nreturn { escHtml, safeNum, safeHref, chainStatusClass };')();

test('escHtml escapes text and both quote styles', () => {
    assert.equal(helpers.escHtml(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
    assert.equal(helpers.escHtml(null), '');
    assert.equal(helpers.escHtml(undefined), '');
    assert.equal(helpers.escHtml(0.85), '0.85');
});

test('safeHref keeps only http(s) and same-site paths, escaped', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:x', 'data:text/html,x', '//evil.example', 'vbscript:x', ' javascript:x', '',
                       '/\\evil.example', '\\\\evil.example', '/\t/evil.example', '/\n/evil.example', 'https://a.example/\\x', 'https://a.example/ x']) {
        assert.equal(helpers.safeHref(bad), '', bad);
    }
    assert.equal(helpers.safeHref('https://vacprotocol.org/auth?a=1&b="2"'), 'https://vacprotocol.org/auth?a=1&amp;b=&quot;2&quot;');
    assert.equal(helpers.safeHref('/auth'), '/auth');
});

test('safeNum turns anything non-numeric into 0', () => {
    assert.equal(helpers.safeNum('<b>'), 0);
    assert.equal(helpers.safeNum('12'), 12);
    assert.equal(helpers.safeNum(Infinity), 0);
    assert.equal(helpers.safeNum(null), 0);
});

test('chain status reaches the class list only from the allow-list', () => {
    assert.equal(helpers.chainStatusClass('active'), 'active');
    assert.equal(helpers.chainStatusClass('revoked'), 'revoked');
    assert.equal(helpers.chainStatusClass('expired'), 'expired');
    assert.equal(helpers.chainStatusClass('x" onmouseover="y'), '');
    assert.equal(helpers.chainStatusClass('__proto__'), '');
});

// Reviewed: each of these is static text, a number or class computed on the page, or
// markup assembled only from escaped pieces (their own inner ${...} are checked too).
const SAFE = new Set([
    'API_BASE',
    "(v.errors||[]).length !== 1 ? 's' : ''",
    "Array(6).fill('<input class=\"otp-digit\" maxlength=\"1\" inputmode=\"numeric\" pattern=\"[0-9]\">').join('')",
    "Array.from({length: Math.min(Math.max(vc, 3), 10)}, (_, i) => `<div class=\"vouch-dot ${i < vc ? 'filled' : ''}\"></div>`).join('')",
    "i < vc ? 'filled' : ''",
    '_errList', '_warnList',
    'alDesc', 'authUrl', 'badge', 'cls', 'col', 'color', 'connCls', 'days', 'dc', 'rc', 'hoursAgo', 'i', 'insp', 'kidLine',
    'methodVal', 'pct', 'prefix', 'sep', 'trustCls', 'vc', 'vouchBackUrl',
    "completed ? '\\u2713' : s.icon", 's.label', "descs[currentState] || ''", 'uc.title',
    "v.chain_length !== 1 ? 's' : ''", "vc !== 1 ? 'es' : ''", "n.is_root ? 'root' : ''",
    'new Date(n.issued_at).toLocaleString()', 'new Date(n.expires_at).toLocaleString()',
    'renderSigResult(sigResult)',
    "sigResult && sigResult.ok === true ? 'Signature: PASS (checked in your browser, below) — the record is genuine; only the permission has lapsed.' : 'Signature: see the check below.'",
]);
// Structural expressions whose only dynamic parts are nested, separately checked ${...}.
// Matched exactly: any edit to one of these must be re-reviewed here.
const STRUCTURAL = new Set([
    "n.is_root ? 'root \\u00b7 depth 0' : `agent: ${escHtml(n.agent_id)} \\u00b7 depth: ${escHtml(n.depth)}`",
    "n.scope_summary.actions.map(a => `<span class=\"scope-tag action\">${escHtml(a)}</span>`).join('')",
    "n.scope_summary.exclusions > 0 ? `<span class=\"scope-tag excluded\">${escHtml(n.scope_summary.exclusions)} excluded</span>` : ''",
    "b.narrowing ? `<div style=\"font-family:var(--mono);font-size:10px;color:var(--text-muted);margin-top:3px;\">Parent: ${escHtml(b.narrowing)}</div>` : ''",
    "n.is_root ? '\\u25cf Root VAT' : `\\u25cf Derived VAT (depth ${escHtml(n.delegation_depth)})${g(\"derived\",\"Authority passed down N steps from the original verified human.\")}`",
]);
// The glossary helper g(key, tip) writes tip into a double-quoted attribute: literal
// arguments only, with no double quote, markup or template characters.
const GLOSS = /^g\("[a-z_]+","[^"<>&\\$`]*"\)$/;
const HELPER = /^(escHtml|safeNum|safeHref|encodeURIComponent|chainStatusClass)\(([\s\S]*)\)(\.toLocaleString\(\))?$/;

function interpolations(src) {
    const out = [];
    for (let at = src.indexOf('${'); at >= 0; at = src.indexOf('${', at + 2)) {
        let depth = 0, j = at + 1;
        for (; j < src.length; j++) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}' && --depth === 0) break;
        }
        out.push(src.slice(at + 2, j).trim());
    }
    return out;
}

// Empty the contents of string and template literals so parentheses inside them cannot
// shift the paren matching below (e.g. escHtml('(') + raw + String(')')).
function stripLiterals(expr) {
    let out = '', q = null;
    for (let k = 0; k < expr.length; k++) {
        const c = expr[k];
        if (q) {
            if (c === '\\') { k++; continue; }
            if (c === q) { out += c; q = null; }
            continue;
        }
        if (c === "'" || c === '"' || c === '`') q = c;
        out += c;
    }
    return out;
}

function balancedHelperCall(raw) {
    const expr = stripLiterals(raw);
    // No reviewed helper call needs a slash outside a string; a regex literal or a comment
    // could hide parentheses from the matching below (e.g. escHtml(/\(/.source) + raw).
    if (expr.includes('/')) return false;
    const m = expr.match(HELPER);
    if (!m) return false;
    // the helper's parenthesis must close at the end, not earlier (e.g. escHtml(a) + b)
    let depth = 0;
    const open = expr.indexOf('(');
    for (let k = open; k < expr.length; k++) {
        if (expr[k] === '(') depth++;
        else if (expr[k] === ')' && --depth === 0) return expr.slice(k + 1) === '' || expr.slice(k + 1) === '.toLocaleString()';
    }
    return false;
}

test('a helper call only counts when the whole expression is inside it', () => {
    assert.ok(balancedHelperCall('escHtml(n.label)'));
    assert.ok(balancedHelperCall("escHtml(String(n.chain_hash || '').substring(0, 32))"));
    assert.ok(balancedHelperCall("safeNum(b.spent).toLocaleString()"));
    for (const bad of ["escHtml('(') + b.label + String(')')", 'escHtml(a) + b', "escHtml(')') + b", 'escHtml("(") + b + ")"',
                       "escHtml(`(`) + b + `)`", "escHtml('\\'(') + b + String(')')", 'escHtmlX(b)', 'b',
                       'escHtml(/\\(/.source) + b.label + String(/\\)/.source)', 'escHtml(a /* ( */) + b + String(/* ) */)']) {
        assert.ok(!balancedHelperCall(bad), bad);
    }
});

test('every interpolation in the verify page is escaped or reviewed as safe', () => {
    assert.ok(main.length > 1000, 'page script found');
    assert.ok(scripts.length >= 2, 'all inline scripts found');
    const bad = interpolations(allScripts).filter(e => !balancedHelperCall(e) && !SAFE.has(e) && !STRUCTURAL.has(e) && !GLOSS.test(e));
    assert.deepEqual(bad, [], 'unescaped interpolations:\n' + bad.join('\n'));
});

test('the values a crafted token or link controls are all escaped', () => {
    for (const expr of ['n.label', 'n.status', 'n.agent_id', 'n.depth', 'a', 'n.scope_summary.exclusions', 'res.kid',
                        'sigResult.kid', 'n.token_id', 'n.trust_score', 'c.claims', 'c.description', 'w', 'b.label',
                        'b.narrowing', 'data.issuer', 'v.assurance_level', 'v.chain_length', '_vouchEmail', 'label']) {
        assert.ok(!interpolations(allScripts).includes(expr), expr + ' is interpolated raw');
    }
    assert.match(main, /class="chain-node-badge \$\{chainStatusClass\(n\.status\)\}"/);
    assert.match(main, /const vouchBackUrl = safeHref\(data\.vouch_back_url\);/);
    assert.match(main, /const vc = Math\.max\(0, Math\.floor\(safeNum\(/);
});
