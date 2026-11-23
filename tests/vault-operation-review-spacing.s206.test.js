// S206: VAC handoff layout regression after successful FULL biometric ceremony.
// RED on vac-web main 2026-11-24. Paired renderer fix is Claude-owned.
// A field's textContent can be distinct in the DOM yet appear as one run-together
// block when auth.html resets every <p> margin to zero.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const handoff = fs.readFileSync(path.join(__dirname, '..', 'vac-vault-handoff.js'), 'utf8');
const auth = fs.readFileSync(path.join(__dirname, '..', 'auth.html'), 'utf8');

test('fixture: the host auth page globally resets paragraph margins', () => {
  assert.match(auth, /\*\s*\{\s*margin\s*:\s*0\s*;/);
});

test('operation review preserves separate, safely rendered label and value nodes', () => {
  const body = handoff.slice(handoff.indexOf('function renderOperation() {'), handoff.indexOf('function renderCriticPreview() {'));
  assert.match(body, /fields\.forEach\(function\s*\(item\)/);
  assert.match(body, /line\.textContent\s*=\s*item\[0\]\s*\+\s*': '\s*\+\s*String\(item\[1\]\)/);
  assert.match(body, /box\.appendChild\(line\)/);
  assert.doesNotMatch(body, /line\.innerHTML\s*=/);
});

test('RED: post-biometric service-operation field rows have visible vertical separation', () => {
  // The universal margin:0 reset in auth.html makes adjacent <p> rows render
  // with NO visible vertical separation. Distinct DOM nodes alone are not a
  // user-acceptable result on an iPad. Accept either explicit per-row spacing,
  // a visible border, or an actual gap in a flex/grid parent; a bare gap on a
  // normal block container is NOT sufficient.
  const body = handoff.slice(handoff.indexOf('function renderOperation() {'), handoff.indexOf('function renderCriticPreview() {'));
  assert.ok(body.length > 100, 'renderOperation must be present');
  const fieldsStart = body.indexOf('fields.forEach(function (item)');
  assert.ok(fieldsStart >= 0, 'expected existing field-row renderer');
  const fieldsEnd = body.indexOf('box.appendChild(line);', fieldsStart);
  assert.ok(fieldsEnd > fieldsStart, 'must append the field row');
  const fieldRenderer = body.slice(fieldsStart, fieldsEnd + 22);
  const boxStyle = body.match(/box\.style\.cssText\s*=\s*'([^']+)'/)?.[1] || '';
  const hasRowSpacing = /line\.style\.(?:cssText|margin(?:Bottom|Top)?|padding(?:Bottom|Top)?|border(?:Bottom|Top)?|display)\s*=/.test(fieldRenderer);
  const hasParentLayoutGap = /display\s*:\s*(?:flex|grid)/.test(boxStyle)
    && /(?:^|;)\s*(?:row-)?gap\s*:\s*(?:[1-9]\d*px|[1-9]\d*rem)/.test(boxStyle);
  const hasScopedCSS = /#vacServiceOperationReview\s+(?:p|\.vac-operation-row)\s*\{[^}]*?(?:margin|padding|border|gap)\s*:\s*[^0\s]/s.test(auth);
  assert.ok(
    hasRowSpacing || hasParentLayoutGap || hasScopedCSS,
    'post-biometric operation rows have no explicit spacing: auth.html resets all <p> margins to 0, and renderOperation() emits unstyled adjacent paragraphs. Give each field a readable row separation and verify on iPad.'
  );
});
