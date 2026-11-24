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

test('unknown frame size or malformed detection -> refuse (fail closed)', () => {
    const pair = [me(), face(1000, 100, 120, 140, 0.9)];
    assert.equal(selectPrimaryFace(pair, 0, 0), null);
    assert.equal(selectPrimaryFace([me(), { score: 0.9 }], W, H), null);
    assert.equal(selectPrimaryFace([me(), face(1000, 100, 120, 140, NaN)], W, H), null);
});
