'use strict';
// mini-yaml.js — F-1202/S179 biometric harness
//
// Zero-dependency YAML-SUBSET parser. This repo has no package.json/node_modules
// (every other test file uses hand-written JS/JSON fixtures, e.g.
// tests/fixtures/mic-test-audio-fixtures.js) — pulling in a real YAML library for
// one manifest file would be the first dependency in the repo. Instead this parses
// the deliberately-small subset manifest.yaml actually uses:
//   - block mappings (indentation-nested `key: value`)
//   - block sequences (`- item`, including `- key: value` list-of-maps)
//   - plain scalars (string/number/bool/null)
//   - folded block scalars (`key: >` followed by an indented paragraph)
//   - flow sequences of bare words (`key: [a, b, c]`)
// It is NOT a general YAML parser — no anchors, no flow mappings, no multi-doc
// streams, no complex quoting. tests/biometric_harness/harness.test.js parses the
// real manifest.yaml as a regression guard, so if the manifest ever needs a
// construct this doesn't support, that test fails loudly rather than silently
// mis-parsing.

function stripComment(line) {
    // Comments only recognised when '#' is preceded by whitespace or is at line start —
    // avoids clipping a legitimate '#' inside a scalar (not used in this manifest, but safe).
    const m = line.match(/(^|\s)#.*$/);
    return m ? line.slice(0, m.index) : line;
}

function indentOf(line) {
    const m = line.match(/^ */);
    return m[0].length;
}

function parseScalar(raw) {
    let s = raw.trim();
    if (s === '' || s === '~' || s === 'null') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    if (s.startsWith('[') && s.endsWith(']')) {
        const inner = s.slice(1, -1).trim();
        if (inner === '') return [];
        return inner.split(',').map((x) => parseScalar(x.trim()));
    }
    return s;
}

// Parses a raw YAML string into plain JS objects/arrays.
function parseYaml(text) {
    const rawLines = text.split('\n');
    const lines = [];
    for (const rl of rawLines) {
        const stripped = stripComment(rl).replace(/\s+$/, '');
        if (stripped.trim() === '') continue;
        lines.push({ indent: indentOf(stripped), text: stripped.trim() });
    }

    let pos = 0;

    function parseBlockScalar(baseIndent) {
        const parts = [];
        let blockIndent = null;
        while (pos < lines.length) {
            const ln = lines[pos];
            if (ln.indent <= baseIndent) break;
            if (blockIndent === null) blockIndent = ln.indent;
            parts.push(ln.text);
            pos++;
        }
        return parts.join(' ').trim();
    }

    // Parses a sequence of `- ...` items at exactly `indent`.
    function parseSequence(indent) {
        const arr = [];
        while (pos < lines.length && lines[pos].indent === indent && lines[pos].text.startsWith('- ')) {
            const itemText = lines[pos].text.slice(2).trim();
            if (itemText === '') {
                pos++;
                arr.push(parseNode(indent + 2));
                continue;
            }
            const kv = matchKeyValue(itemText);
            if (kv) {
                // `- key: value` starts a map; the rest of the map continues indented
                // at least as far as this key started (indent + 2, i.e. past "- ").
                pos++;
                const obj = {};
                assignKv(obj, kv, indent + 2);
                Object.assign(obj, parseMapContinuation(indent + 2));
                arr.push(obj);
            } else {
                pos++;
                arr.push(parseScalar(itemText));
            }
        }
        return arr;
    }

    function matchKeyValue(text) {
        const m = text.match(/^([A-Za-z0-9_.\-]+):(\s(.*))?$/);
        if (!m) return null;
        return { key: m[1], rest: (m[3] || '').trim() };
    }

    function assignKv(obj, kv, indent) {
        if (kv.rest === '>' || kv.rest === '|') {
            obj[kv.key] = parseBlockScalar(indent);
        } else if (kv.rest === '') {
            // Nested block starts on next line — could be a map or a sequence.
            if (pos < lines.length && lines[pos].indent > indent && lines[pos].text.startsWith('- ')) {
                obj[kv.key] = parseSequence(lines[pos].indent);
            } else if (pos < lines.length && lines[pos].indent > indent) {
                obj[kv.key] = parseNode(lines[pos].indent);
            } else {
                obj[kv.key] = null;
            }
        } else {
            obj[kv.key] = parseScalar(kv.rest);
        }
    }

    // Continues consuming `key: value` siblings at `indent` into a fresh object
    // (used right after a `- key: value` opened the map on the same line as the dash).
    function parseMapContinuation(indent) {
        const obj = {};
        while (pos < lines.length && lines[pos].indent === indent && !lines[pos].text.startsWith('- ')) {
            const kv = matchKeyValue(lines[pos].text);
            if (!kv) throw new Error('mini-yaml: expected "key: value" at line: ' + lines[pos].text);
            pos++;
            assignKv(obj, kv, indent);
        }
        return obj;
    }

    // Parses a block map or sequence starting at the current `pos`, all at `indent`.
    function parseNode(indent) {
        if (pos < lines.length && lines[pos].indent === indent && lines[pos].text.startsWith('- ')) {
            return parseSequence(indent);
        }
        const obj = {};
        while (pos < lines.length && lines[pos].indent === indent) {
            const kv = matchKeyValue(lines[pos].text);
            if (!kv) throw new Error('mini-yaml: expected "key: value" at line: ' + lines[pos].text);
            pos++;
            assignKv(obj, kv, indent);
        }
        return obj;
    }

    if (lines.length === 0) return {};
    const topIndent = lines[0].indent;
    return parseNode(topIndent);
}

module.exports = { parseYaml };
