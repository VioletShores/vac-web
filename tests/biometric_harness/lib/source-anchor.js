'use strict';
// source-anchor.js — F-1202/S179 biometric harness
//
// Shared source-extraction helpers, factored out of tests/mic-voiced-run.test.js's
// constFromSource() so every stage module in tests/biometric_harness/stages/ can
// anchor its mirror to the same shipped-source constants/expressions instead of
// hand-copying the regex. If a stage's mirror and vac-reauth-ceremony.js diverge,
// these throw with the source line context — same failure mode the seed harness
// established.

const fs = require('node:fs');
const path = require('node:path');

const CEREMONY_SRC_PATH = path.join(__dirname, '..', '..', '..', 'vac-reauth-ceremony.js');
const FACE_EMBED_SRC_PATH = path.join(__dirname, '..', '..', '..', 'vac-face-embed.js');
const FINGER_DETECT_SRC_PATH = path.join(__dirname, '..', '..', '..', 'vac-finger-detect.js');

function readSrc(p) { return fs.readFileSync(p, 'utf8'); }

function constFromSource(src, name, srcLabel) {
    const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
    if (!m) throw new Error(`expected "const ${name} = ...;" in ${srcLabel || '(source)'} — mirror and source have diverged`);
    const value = Function('"use strict"; return (' + m[1] + ');')();
    if (typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`${name} did not evaluate to a number/boolean: ${m[1]}`);
    }
    return value;
}

function requireIncludes(src, needle, message) {
    if (!src.includes(needle)) throw new Error(message || `expected source to include: ${needle}`);
}

// Extract a uniquely named, conventionally indented shipped function. Closing
// delimiters must have the declaration's indentation; compile catches truncation.
// This is deliberately fail-closed for source layout changes, not a JS parser.
function functionFromSource(src, name) {
    const starts = [...src.matchAll(new RegExp('^([ \t]*)function ' + name + '\\([^\\n]*\\) \\{', 'gm'))];
    if (starts.length !== 1) throw new Error(`expected one shipped function ${name}`);
    const start = starts[0];
    const tail = src.slice(start.index + start[0].length);
    const end = tail.match(new RegExp('^' + start[1] + '\\}', 'm'));
    if (!end) throw new Error(`missing function end: ${name}`);
    const body = src.slice(start.index, start.index + start[0].length + end.index + end[0].length);
    Function(body); // syntax-check before any fixture can claim a result
    return body;
}

function declarationFromSource(src, name, indent, kind) {
    const hits = [...src.matchAll(new RegExp('^' + (indent === undefined ? '[ \t]*' : ' '.repeat(indent)) + (kind || '(?:const|var)') + '\\s+' + name + '\\s*=\\s*[^;]+;', 'gm'))];
    if (hits.length !== 1) throw new Error(`expected one shipped declaration ${name}`);
    return hits[0][0];
}

module.exports = {
    CEREMONY_SRC_PATH, FACE_EMBED_SRC_PATH, FINGER_DETECT_SRC_PATH,
    readSrc, constFromSource, requireIncludes, functionFromSource, declarationFromSource,
};
