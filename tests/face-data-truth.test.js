// FACE-DATA-TRUTH (S206; Rob, 23 Nov 2026): what the ceremony and the privacy pages say about
// face and voice data must match what the backend does. These pin the wording to the facts
// established by a read-only trace of the backend on 23 Nov 2026:
//   - our code keeps no video, photo or voice recording from the ceremony;
//   - it DOES keep a written description of appearance AND a 128-number face template;
//   - the recording is sent to outside companies to be checked;
//   - the quick (single photo) tier sends no video and writes nothing new.
// If the backend changes any of these, change the copy and these tests together.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ceremony = read('vac-reauth-ceremony.js');
const registry = read('vac-copy-registry.js');
const privacy = read('athena-privacy.html');
const ladder = read('content/blocks/privacy-ladder.md');

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// What we keep is written once (VAC_FACE_KEPT) and placed into the markup. Read the object
// from the source and substitute it, so these tests see the words a person sees.
function keptStrings() {
  const start = ceremony.indexOf('const VAC_FACE_KEPT = {');
  assert.ok(start > 0, 'VAC_FACE_KEPT is defined');
  const body = ceremony.slice(start, ceremony.indexOf('};', start));
  const out = {};
  for (const m of body.matchAll(/^\s*(line|detail|saved): '([^'\n]*)',$/gm)) out[m[1]] = m[2];
  assert.deepStrictEqual(Object.keys(out).sort(), ['detail', 'line', 'saved']);
  return out;
}

function preflightBlock() {
  const start = ceremony.indexOf('<div class="privacy-statement">');
  const end = ceremony.indexOf('id="btnCamera"', start);
  assert.ok(start > 0 && end > start, 'privacy statement sits before the camera button');
  const kept = keptStrings();
  return ceremony.slice(start, end).replace(/\$\{VAC_FACE_KEPT\.(line|detail|saved)\}/g, (_, k) => kept[k]);
}

test('the statement is shown before the camera is turned on', () => {
  preflightBlock();
});

test('the line names both things that are kept: the description and the face numbers', () => {
  const t = text(preflightBlock());
  assert.match(t, /We don’t keep your video or photo\./);
  assert.match(t, /written description of your appearance/);
  assert.match(t, /set of numbers that describes your face/);
});

test('the line says the recording goes to verification partners', () => {
  assert.match(text(preflightBlock()), /sent to our verification partners/);
});

test('the fold answers the question in plain words and names the companies', () => {
  const block = preflightBlock();
  assert.match(block, /<summary>How is my face data handled\?<\/summary>/);
  const t = text(block);
  for (const heading of ['What is captured', 'Where it goes', 'What we keep', 'What we don’t keep',
    'What we can’t promise yet', 'Your choice']) {
    assert.ok(t.includes(heading), heading);
  }
  assert.match(t, /Google \(the video\) and Deepgram \(the words you say\)/);
  assert.match(t, /128 numbers that describes your face\. It is numbers, not a picture\./);
});

test('the fold does not promise what has not been confirmed', () => {
  const t = text(preflightBlock());
  assert.match(t, /How long those companies hold what they receive\. We are confirming it/);
  assert.doesNotMatch(t, /immediately discarded|never leaves|not retained by/i);
});

test('the old statement, which left out the face template, is gone everywhere', () => {
  for (const src of [ceremony, registry]) {
    assert.ok(!src.includes('We store a text description of your appearance —'));
    assert.ok(!src.includes('Recording is analysed in real-time and discarded'));
  }
});

test('no engineering string is shown while the recording is checked', () => {
  for (const src of [ceremony, registry]) {
    assert.ok(!src.includes('Video + Audio → Gemini + Deepgram'));
    assert.ok(!src.includes('KB → verification engines'));
  }
  assert.ok(ceremony.includes("detailEl.textContent = 'Being checked by our verification partners. We don\u2019t keep it.';"));
});

test('"one photo confirms it is you" no longer reads as a kept picture', () => {
  // comments may still quote the old wording as history; no string a person sees may
  for (const src of [ceremony, registry]) assert.ok(!/'[^'\n]*one photo confirms it[^'\n]*'/.test(src));
  assert.ok(ceremony.includes('one photo, checked and not kept.'));
});

test('the quick tier has its own true wording: no video, nothing new saved', () => {
  const start = ceremony.indexOf('function _vacPrivacyForQuickTier()');
  const fn = ceremony.slice(start, ceremony.indexOf('\n}\n', start));
  assert.ok(start > 0);
  assert.match(fn, /We don\u2019t keep your photo or your voice\./);
  assert.match(fn, /One photo and about two seconds of sound\. No video\./);
  assert.match(fn, /Nothing new from this check\./);
  assert.ok(fn.includes('VAC_FACE_KEPT.saved'), 'and it names what was saved from the one shared wording');
  assert.match(fn, /Deepgram \(the number you say\) and Didit \(a live-person check on the photo\)/);
  assert.ok(ceremony.includes('_vacPrivacyForQuickTier();'), 'and the pre-flight setup calls it');
});

test('the quick-tier wording is set as text, never as markup', () => {
  const start = ceremony.indexOf('function _vacPrivacyForQuickTier()');
  const fn = ceremony.slice(start, ceremony.indexOf('\n}\n', start));
  assert.ok(!/innerHTML/.test(fn));
});

test('the fold uses the confirmed palette, not purple', () => {
  const css = ceremony.slice(ceremony.indexOf('.vac-face-data {'), ceremony.indexOf('.vac-face-data a {') + 80);
  assert.match(css, /var\(--teal, #2DD4BF\)/);
  assert.doesNotMatch(css, /purple|6c5ce7|108,\s*92,\s*231/i);
  assert.match(css, /min-height: 44px/, 'the fold is a comfortable tap target');
});

test('the privacy page says the template is kept and no longer claims "any server"', () => {
  const t = text(privacy);
  assert.match(t, /We do keep two things that describe your face/);
  assert.match(t, /face template : a set of 128 numbers|face template: a set of 128 numbers/);
  assert.doesNotMatch(t, /are stored on any server/);
  assert.doesNotMatch(t, /not retained by these providers/);
  assert.match(t, /We have not yet confirmed in writing how long/);
});

test('the guest-page block no longer says biometrics are not stored or enrolled', () => {
  assert.doesNotMatch(ladder, /never stored|not stored, enrolled|zero-retention|architecturally enforced/i);
  assert.match(ladder, /face template/);
  const rendered = read('p/matteo-9be78161d6a7.html');
  assert.doesNotMatch(rendered, /Zero-retention by construction|processed in-session and never stored/);
});

test('what we keep is worded in exactly one place', () => {
  const kept = keptStrings();
  assert.match(kept.line, /written description of your appearance and a set of numbers/);
  // outside the object, the ceremony source never spells the stored items out again
  const start = ceremony.indexOf('const VAC_FACE_KEPT = {');
  const rest = ceremony.slice(0, start) + ceremony.slice(ceremony.indexOf('};', start));
  assert.ok(!/written description of your appearance/.test(rest.replace(/\/\/[^\n]*/g, '')));
  assert.strictEqual((ceremony.match(/\$\{VAC_FACE_KEPT\.line\}/g) || []).length, 1);
  assert.strictEqual((ceremony.match(/\$\{VAC_FACE_KEPT\.detail\}/g) || []).length, 1);
});

test('nothing is said about system logs', () => {
  // The logging of spoken words is being removed in the backend, which ships first.
  for (const src of [ceremony, registry, privacy]) assert.doesNotMatch(src, /system log/i);
});
