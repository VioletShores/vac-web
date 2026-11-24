'use strict';
// S207: known-answer cases for VACFaceEmbed.selectPrimaryFace, the calibrated
// multi-face rule. Loads the real shipped vac-face-embed.js in a vm (no network:
// compute()/ready() are never called).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'vac-face-embed.js');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });
const { selectPrimaryFace } = sandbox.window.VACFaceEmbed;

const W = 1280, H = 720;
// A face centred in a 1280x720 frame, about 300x360 px (a person at the camera).
const me = (score = 0.97) => ({ score, box: { x: 490, y: 180, width: 300, height: 360 } });
const face = (x, y, w, h, score) => ({ score, box: { x, y, width: w, height: h } });

test('one face is not this function\'s case (compute() handles n === 1)', () => {
    assert.equal(selectPrimaryFace([me()], W, H), null);
});

test('mirror reflection behind the user: small, any confidence -> accept, primary used', () => {
    // 120x140 reflection = 16800 px^2 vs 108000 primary: ratio 0.156 <= 0.25
    const r = selectPrimaryFace([face(1000, 100, 120, 140, 0.92), me()], W, H);
    assert.deepEqual({ ...r }, { index: 1, ignored: 1 });
});

test('dim, low-confidence reflection up to half the size -> accept', () => {
    // 200x240 = 48000 / 108000 = 0.44 <= 0.5 and score 0.55 < 0.6
    const r = selectPrimaryFace([me(), face(950, 200, 200, 240, 0.55)], W, H);
    assert.deepEqual({ ...r }, { index: 0, ignored: 1 });
});

test('a second confident face of similar size (another person) -> refuse', () => {
    assert.equal(selectPrimaryFace([me(), face(900, 200, 260, 320, 0.95)], W, H), null);
});

test('second face just over the small-face bound and confident -> refuse', () => {
    // 170x170 = 28900 / 108000 = 0.268 > 0.25, score 0.9 >= 0.6
    assert.equal(selectPrimaryFace([me(), face(1000, 100, 170, 170, 0.9)], W, H), null);
});

test('low-confidence extra but more than half the size -> refuse', () => {
    // 240x260 = 62400 / 108000 = 0.58 > 0.5
    assert.equal(selectPrimaryFace([me(), face(900, 200, 240, 260, 0.5)], W, H), null);
});

test('largest face not confident enough -> refuse', () => {
    assert.equal(selectPrimaryFace([me(0.75), face(1000, 100, 100, 100, 0.9)], W, H), null);
});

test('largest face off-centre (user not in the oval) -> refuse', () => {
    const offCentre = face(20, 180, 300, 360, 0.97); // centre x = 170/1280 = 0.13
    assert.equal(selectPrimaryFace([offCentre, face(700, 300, 80, 90, 0.9)], W, H), null);
});

test('more than two extra faces -> refuse', () => {
    const tiny = (x) => face(x, 20, 60, 60, 0.7);
    assert.equal(selectPrimaryFace([me(), tiny(10), tiny(100), tiny(1150)], W, H), null);
});

test('two minor extras -> accept', () => {
    const tiny = (x) => face(x, 20, 60, 60, 0.7);
    const r = selectPrimaryFace([tiny(10), me(), tiny(1150)], W, H);
    assert.deepEqual({ ...r }, { index: 1, ignored: 2 });
});

// ── descriptorFromDetections: exactly what compute() returns after detection ──
const { descriptorFromDetections } = sandbox.window.VACFaceEmbed;
const desc = (fill) => new Array(128).fill(fill);
const frame = { videoWidth: W, videoHeight: H };
const det = (f, d) => ({ detection: { score: f.score, box: f.box }, descriptor: d });

test('compute() uses results[chosen]: the PRIMARY face\'s descriptor, wherever it sits in the list', () => {
    // The reflection comes FIRST in detector order; the descriptor must still be the primary's.
    const r = descriptorFromDetections([det(face(1000, 100, 120, 140, 0.92), desc(0.9)), det(me(), desc(0.1))], frame);
    assert.equal(r.ok, true);
    assert.equal(r.embedding.length, 128);
    assert.ok(r.embedding.every((v) => v === 0.1), 'must be results[chosen].descriptor, never results[0]');
    assert.equal(r.ignoredFaces, 1);
    assert.equal(r.faceCount, 2);
    assert.deepEqual([...r.warnings], ['extra_faces_ignored']);
});

test('a distant real second face: the client may ignore it but MUST report it (server refuses on its own count)', () => {
    // A small, confident face far behind the user. The client rule accepts it as minor;
    // what matters is that ignoredFaces > 0 is reported, so the server gives no band,
    // and the server's own faces_seen gate (vac-protocol) refuses the ceremony.
    const bystander = face(1100, 60, 90, 110, 0.95);
    const r = descriptorFromDetections([det(me(), desc(0.2)), det(bystander, desc(0.7))], frame);
    assert.equal(r.ok, true);
    assert.equal(r.ignoredFaces, 1, 'an ignored face is never silent');
    assert.ok(r.embedding.every((v) => v === 0.2));
});

test('one face -> ignoredFaces 0; two real people -> multiple_faces, no descriptor', () => {
    const one = descriptorFromDetections([det(me(), desc(0.3))], frame);
    assert.equal(one.ok, true); assert.equal(one.ignoredFaces, 0); assert.equal(one.faceCount, 1);
    const two = descriptorFromDetections([det(me(), desc(0.3)), det(face(900, 200, 260, 320, 0.95), desc(0.6))], frame);
    assert.equal(two.ok, false); assert.equal(two.reason, 'multiple_faces'); assert.equal(two.embedding, undefined);
});

test('chosen descriptor malformed -> embedder_error (never falls back to another face)', () => {
    const r = descriptorFromDetections([det(face(1000, 100, 120, 140, 0.92), desc(0.9)), det(me(), [0.1, 0.2])], frame);
    assert.equal(r.ok, false); assert.equal(r.reason, 'embedder_error');
    const nan = desc(0.1); nan[5] = NaN;
    assert.equal(descriptorFromDetections([det(me(), nan)], frame).reason, 'embedder_error');
});

test('compute() delegates to descriptorFromDetections (no second code path)', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    assert.match(src, /return descriptorFromDetections\(results, input\);/);
    assert.equal((src.match(/var desc = results\[chosen\] && results\[chosen\]\.descriptor;/g) || []).length, 1,
        'exactly one place reads a descriptor, and it reads results[chosen]');
    assert.doesNotMatch(src, /results\[0\]\.descriptor/);
});

test('the full ceremony forwards client_ignored_faces next to face_embedding', () => {
    const cer = fs.readFileSync(path.join(__dirname, '..', 'vac-reauth-ceremony.js'), 'utf8');
    assert.match(cer, /formData\.append\('client_ignored_faces', String\(window\.__vacEnrollIgnoredFaces \|\| 0\)\)/);
    assert.match(cer, /window\.__vacEnrollIgnoredFaces = _result\.ignoredFaces \|\| 0;/);
    assert.match(cer, /window\.__vacEnrollIgnoredFaces = 0;/);
});

test('server single_face refusals get honest text (no "more than one" for no_face)', () => {
    const VR = require(path.join(__dirname, '..', 'verdict-reasons.js'));
    const multi = VR.deriveFailureDisplay({ verdict: { reasons: ['single_face:multiple_faces(faces_seen=2)'] } });
    assert.deepEqual(multi.reasons, ['More than one face was visible during the recording.']);
    assert.match(multi.tips[0], /no one behind you, and no mirror/);
    const none = VR.deriveFailureDisplay({ verdict: { reasons: ['single_face:no_face(faces_seen=0)'] } });
    assert.deepEqual(none.reasons, ['No face was clearly visible during the recording.']);
    assert.doesNotMatch(none.tips.join(' '), /more than one|behind you/i);
});

test('unknown frame size or malformed detection -> refuse (fail closed)', () => {
    const pair = [me(), face(1000, 100, 120, 140, 0.9)];
    assert.equal(selectPrimaryFace(pair, 0, 0), null);
    assert.equal(selectPrimaryFace([me(), { score: 0.9 }], W, H), null);
    assert.equal(selectPrimaryFace([me(), face(1000, 100, 120, 140, NaN)], W, H), null);
});
