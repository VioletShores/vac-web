// ceremony-harness-fixtures.pw.js — F-1139 S164 Phase 1: REAL-gate fixture runner
//
// WHAT THIS IS: drives the ACTUAL production _phraseVadTick / runAVFrame mic-qualify block in a
// real Chromium page — not a reimplementation. This is the piece that closes the L-511/L-676
// anti-trap gap left by tests/ceremony-gate-harness.test.js (which mirrors the gate logic in Node
// because vac-reauth-ceremony.js cannot be require()'d outside a browser). Here, the fixture bytes
// are injected at the analyser-read boundary via the F-1139 seam (window.__vacTestAudioFill /
// window.__vacTestAvAudioFill, added directly in vac-reauth-ceremony.js next to the two
// getByteTimeDomainData/getByteFrequencyData call sites) — everything downstream (RMS calc,
// voice-band ratio, sustain counters, PHRASE_VOICED_TICKS_NEEDED / PHRASE_MOD_DELTA gates,
// _micQualifyFloor, avVbSustain) is the unmodified shipped function running on our synthetic input.
//
// MEDIA STRATEGY: rather than hand-mocking getUserMedia/AudioContext (fragile — a fake stream
// object fails real AudioContext.createMediaStreamSource() validation, which would leave
// avAnalyser/audioAnalyser null and defeat the harness), Chromium is launched with
// --use-fake-device-for-media-stream (+ --use-fake-ui-for-media-stream to skip the permission
// prompt headlessly). requestCamera() then calls the REAL getUserMedia and gets a REAL (synthetic)
// camera+mic MediaStream — real analysers attach, real video playback progresses. The synthetic
// device's own audio is irrelevant: our injection seam overwrites the analyser buffers before the
// gate ever reads them, so the GATE DECISION is driven entirely by the fixture, not by whatever
// tone Chromium's fake mic happens to emit.
//
// SCOPE (Phase 1, this lane): PHRASE gate (primary target — see F1139-HARNESS-DESIGN-S164.md for
// why this is the reliable target: _phraseVadTick fires on a plain setInterval(200ms), independent
// of video/canvas readiness). MIC-QUALIFY (AV preflight) fixtures are included as a secondary,
// best-effort sensor — that path is gated behind video.paused/readyState at the top of runAVFrame,
// which is less deterministic to drive from a synthetic device; failures there are reported, not
// silently swallowed.
//
// STATUS: this file could not be executed in the authoring sandbox (headless Chromium requires
// system shared libraries — libglib2.0, libnss3, libatk, etc. — installable only via
// `playwright install --with-deps`, which needs root; the sandbox user has no sudo). It has NOT
// been run locally. CI (GitHub Actions, ubuntu-latest, sudo available) is authoritative for whether
// this passes — see the ceremony-harness-fixtures.yml workflow. Do not treat this file's mere
// existence as proof the fixtures pass; check the CI run.
//
// Run (locally, if system deps are available): npx playwright install --with-deps chromium
//                                                npx playwright test tests/ceremony-harness-fixtures.pw.js

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');
const { FIXTURES, MIC_FIXTURES } = require('./fixtures/ceremony-audio-fixtures');

const HARNESS_URL = 'file://' + path.join(__dirname, 'fixtures', 'greeting-harness.html') + '?debug=1';

// Real fixture bootstrap needs more headroom than the 15s project default (camera grant + AV
// settle + up to ~14s of 200ms phrase ticks per fixture).
test.setTimeout(45000);

test.use({
    launchOptions: {
        args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
});

function toPlainFrames(frames) {
    return frames.map((f) => ({ tdBuf: Array.from(f.tdBuf), freqBuf: Array.from(f.freqBuf) }));
}

async function mockNonMediaBrowserApis(page) {
    // Only mocks what has nothing to do with the audio gate under test: SpeechRecognition (so the
    // content gate is disabled and the phrase gate falls back to the energy/voice-band path this
    // harness targets — same choice greeting-audible.pw.js makes), MediaRecorder (no real
    // recording needed), FingerDetector (no MediaPipe/CDN in CI), canvas brightness (avoids
    // depending on the fake-device video frame's actual pixel content), and fetch (challenge data).
    await page.addInitScript(() => {
        window.SpeechRecognition = undefined;
        window.webkitSpeechRecognition = undefined;

        window.MediaRecorder = function () {
            this.state = 'inactive';
            this.ondataavailable = null;
            this.onstop = null;
            this.start = function () { this.state = 'recording'; };
            this.stop = function () {
                this.state = 'inactive';
                if (this.ondataavailable) this.ondataavailable({ data: new Blob([], { type: 'audio/webm' }) });
                if (this.onstop) this.onstop();
            };
            this.pause = function () {};
            this.resume = function () {};
        };
        window.MediaRecorder.isTypeSupported = function () { return true; };

        window.FingerDetector = {
            landmarks: null,
            detect: function () {
                var lm = [];
                for (var i = 0; i < 21; i++) lm.push({ x: 0.18, y: 0.48 });
                this.landmarks = lm;
                return { fingers: 2 };
            },
            warmOnce: function () {},
            reset: function () {},
            init: function () {},
            ready: true,
            failed: false,
        };

        try {
            var _origDrawImage = CanvasRenderingContext2D.prototype.drawImage;
            CanvasRenderingContext2D.prototype.drawImage = function () {
                try { _origDrawImage.apply(this, arguments); } catch (e) {}
            };
            CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h) {
                var data = new Uint8ClampedArray(w * h * 4);
                for (var i = 0; i < data.length; i += 4) { data[i] = 150; data[i + 1] = 150; data[i + 2] = 150; data[i + 3] = 255; }
                return new ImageData(data, w, h);
            };
        } catch (e) {}

        var _origFetch = window.fetch;
        window.fetch = function (url) {
            var u = String(url || '');
            if (u.includes('challenge')) {
                return Promise.resolve({
                    ok: true, status: 200,
                    json: function () { return Promise.resolve({ phrase: 'Hello there, I am Fixture Tester', digits: [3, 2], session_id: 'f1139-fixture-test' }); },
                    text: function () { return Promise.resolve('{}'); },
                });
            }
            return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve(''); } });
        };
    });
}

async function bootstrapToGreeting(page) {
    await page.goto(HARNESS_URL);
    await page.waitForLoadState('domcontentloaded');

    const reauthAvail = await page.evaluate(() => typeof window.VACReauth !== 'undefined' && typeof window.VACReauth.run === 'function');
    expect(reauthAvail, 'VACReauth must be defined (vac-reauth-ceremony.js loaded)').toBe(true);

    const runOk = await page.evaluate(() => {
        try {
            var mount = document.getElementById('mount');
            if (!mount) { mount = document.createElement('div'); mount.id = 'mount'; document.body.appendChild(mount); }
            window.VACReauth.run({
                name: 'Fixture Tester', email: 'f1139-fixture@test.vacprotocol.test',
                mount: mount, riskLevel: 'medium', context: 'test',
                onComplete: function () {}, onBack: function () {}, onStep: function () {},
            });
            return 'ok';
        } catch (e) { return String(e); }
    });
    expect(runOk, 'VACReauth.run() must succeed').toBe('ok');

    // Real getUserMedia via the fake-device flag — grants a synthetic camera+mic MediaStream so
    // avAnalyser/audioAnalyser attach for real (see file header: this is why we don't hand-mock it).
    await page.evaluate(() => { try { window.requestCamera(); } catch (e) {} });

    await page.waitForFunction(() => {
        var v = document.getElementById('videoPreview');
        return v && v.readyState >= 2;
    }, { timeout: 10000 }).catch(() => {});

    // AV checks (light/mic/hand) are best-effort here — the PHRASE gate assertion below doesn't
    // depend on them (see MIC-QUALIFY tests for that path). Force the button through if AV timing
    // in CI doesn't settle within the wait, same fallback greeting-audible.pw.js uses.
    await page.waitForFunction(() => {
        var btn = document.getElementById('btnCamera');
        return btn && !btn.disabled && btn.onclick && btn.onclick.name !== 'requestCamera';
    }, { timeout: 8000 }).catch(() => {});

    await page.evaluate(() => {
        var btn = document.getElementById('btnCamera');
        if (btn) { btn.disabled = false; if (btn.onclick) { try { btn.onclick(); } catch (e) {} } }
    });

    await page.waitForTimeout(300);
    await page.evaluate(() => {
        try { window.dismissChallengeIntro(); } catch (e) {}
        setTimeout(function () {
            try { if (typeof window._vacSoundResult === 'function') window._vacSoundResult(true); } catch (e) {}
        }, 50);
    });
}

// Wires the F-1139 seam so each call to _phraseVadTick's audio read pulls the NEXT fixture frame
// (deterministic — one fixture frame per real 200ms phraseInterval tick, not wall-clock-timed).
// Called BEFORE bootstrapToGreeting() (mirroring how the MIC-QUALIFY tests below wire their seam
// before requestCamera()) so window.__vacTestAudioFill is already in place for _phraseVadTick's
// very first live tick — wiring it only after observing window.__vacGateArmed would mean tick 0
// already consumed a real (fake-device) analyser read via the seam's `else` branch before fixture
// frame 0 ever got served, silently shifting every fixture's frame indices by one.
async function wireFixtureFeed(page, frames) {
    await page.evaluate((plainFrames) => {
        window.__vacFixtureFrameIdx = 0;
        window.__vacTestAudioFill = function (tdBuf, freqBuf) {
            var i = Math.min(window.__vacFixtureFrameIdx, plainFrames.length - 1);
            var f = plainFrames[i];
            for (var k = 0; k < tdBuf.length; k++) tdBuf[k] = f.tdBuf[k % f.tdBuf.length];
            for (var k = 0; k < freqBuf.length; k++) freqBuf[k] = f.freqBuf[k % f.freqBuf.length];
            window.__vacFixtureFrameIdx++;
        };
    }, frames);
}

// In-page console interceptor (same idiom as greeting-audible.pw.js's __vacDbgGreetingAudible):
// sets a boolean flag on window the moment the target [VAC-DBG] event logs, so callers can
// page.waitForFunction() on it instead of polling a Node-side array with a manual sleep loop.
async function watchForVacDebugEvent(page, eventName, flagName) {
    await page.evaluate(({ eventName, flagName }) => {
        window[flagName] = false;
        var _origLog = console.log;
        console.log = function () {
            _origLog.apply(console, arguments);
            if (String(arguments[0]).includes('[VAC-DBG]') && String(arguments[1] || '').includes(eventName)) {
                window[flagName] = true;
            }
        };
    }, { eventName, flagName });
}

// ── PHRASE gate: the primary, reliable target (see file header) ──────────────────────────────

test.describe('F-1139 PHRASE gate — real _phraseVadTick driven by synthetic fixtures', () => {
    for (const [name, fixture] of Object.entries(FIXTURES)) {
        test(`PHRASE (real gate via injection seam): ${name} — expected ${fixture.expectedOutcome}`, async ({ page }) => {
            const vacEvents = [];
            page.on('console', (msg) => { if (msg.text().includes('[VAC-DBG]')) vacEvents.push(msg.text()); });

            await mockNonMediaBrowserApis(page);
            await watchForVacDebugEvent(page, 'phrase_speech_confirmed', '__vacFixturePhraseConfirmed');

            const plainFrames = toPlainFrames(fixture.frames);
            await wireFixtureFeed(page, plainFrames);

            await bootstrapToGreeting(page);

            // Up to ~PHRASE_VOICED_TICKS_NEEDED(7) * 200ms + silence-confirm + margin. STUCK
            // fixtures intentionally run the full budget (nothing to wait for early — waitForFunction
            // resolves false-path via the timeout+catch below, same as the rest of this file's idiom).
            const fired = await page.waitForFunction(
                () => window.__vacFixturePhraseConfirmed === true,
                { timeout: 16000 }
            ).then(() => true).catch(() => false);

            const framesConsumed = await page.evaluate(() => window.__vacFixtureFrameIdx || 0);
            const gateArmed = await page.evaluate(() => window.__vacGateArmed === true);

            // If the analyser never armed, this run proves nothing about the gate — fail loudly
            // (distinct from a genuine STUCK fixture result) rather than reporting a false pass.
            expect(gateArmed, `harness setup failed to reach the phrase gate (audioAnalyser never armed) — ` +
                `framesConsumed=${framesConsumed}, vacEvents=${JSON.stringify(vacEvents.slice(0, 10))}`).toBe(true);

            if (fixture.expectedOutcome === 'PHRASE_FIRES') {
                expect(fired, `${name}: expected phrase_speech_confirmed to fire (bona fide voiced run) but it did not. ` +
                    `framesConsumed=${framesConsumed}`).toBe(true);
            } else if (fixture.expectedOutcome === 'PHRASE_STUCK') {
                expect(fired, `${name}: expected the gate to stay STUCK (reject) but phrase_speech_confirmed fired`).toBe(false);
            } else {
                // DOCUMENTS_BEHAVIOR (second_speaker, greeting_at_3m): record, don't assert.
                test.info().annotations.push({ type: 'F-1139 result', description: `${name}: ${fired ? 'FIRES' : 'STUCK'} (documents current behavior, no pass/fail asserted)` });
            }
        });
    }

    // ── Starvation-escape control scenario (real gate, matches the Node mirror's control test) ──
    // The Node mirror (ceremony-gate-harness.test.js) has a "STARVATION ESCAPE" test proving that
    // when _vadStarved + a healthy MediaRecorder-proxy level are both forced on, IOS_AMPLITUDE_CRUSH
    // DOES advance — i.e. the escape path itself works, and the bug is specifically that 3% RMS
    // never TRIGGERS starvation detection automatically. That claim was previously only checked
    // against the mirror. This test checks it against the real, unmodified _phraseVadTick via the
    // window.__vacSetVadStarved / window.__vacSetMrLevel seam hooks.
    test('PHRASE (real gate) [STARVATION ESCAPE]: IOS_AMPLITUDE_CRUSH fires when _vadStarved+MR-level are forced on', async ({ page }) => {
        const vacEvents = [];
        page.on('console', (msg) => { if (msg.text().includes('[VAC-DBG]')) vacEvents.push(msg.text()); });

        await mockNonMediaBrowserApis(page);
        await watchForVacDebugEvent(page, 'phrase_speech_confirmed', '__vacFixturePhraseConfirmed');

        const plainFrames = toPlainFrames(FIXTURES.IOS_AMPLITUDE_CRUSH.frames);
        await wireFixtureFeed(page, plainFrames);
        await page.evaluate(() => {
            if (typeof window.__vacSetVadStarved === 'function') window.__vacSetVadStarved(true);
            if (typeof window.__vacSetMrLevel === 'function') window.__vacSetMrLevel(20);
        });

        await bootstrapToGreeting(page);

        const fired = await page.waitForFunction(
            () => window.__vacFixturePhraseConfirmed === true,
            { timeout: 16000 }
        ).then(() => true).catch(() => false);

        const gateArmed = await page.evaluate(() => window.__vacGateArmed === true);
        expect(gateArmed, `harness setup failed to reach the phrase gate — vacEvents=${JSON.stringify(vacEvents.slice(0, 10))}`).toBe(true);
        expect(fired, 'IOS_AMPLITUDE_CRUSH with _vadStarved=true and MR level=20 forced on should fire via the spectral escape path — if this fails, either the escape path itself is broken, or the starvation setter seam is not reaching _phraseVadTick').toBe(true);
    });
});

// ── MIC-QUALIFY (AV preflight): secondary, best-effort — see file header ─────────────────────

test.describe('F-1139 MIC-QUALIFY gate — real runAVFrame mic-qualify block (best-effort)', () => {
    for (const [name, fixture] of Object.entries(MIC_FIXTURES)) {
        test(`MIC-QUALIFY (real gate via injection seam): ${name} — expected ${fixture.expectedOutcome}`, async ({ page }) => {
            await mockNonMediaBrowserApis(page);
            await page.goto(HARNESS_URL);
            await page.waitForLoadState('domcontentloaded');

            await page.evaluate(() => {
                var mount = document.getElementById('mount');
                if (!mount) { mount = document.createElement('div'); mount.id = 'mount'; document.body.appendChild(mount); }
                window.VACReauth.run({
                    name: 'Fixture Tester', email: 'f1139-mic-fixture@test.vacprotocol.test',
                    mount: mount, riskLevel: 'medium', context: 'test',
                    onComplete: function () {}, onBack: function () {}, onStep: function () {},
                });
            });

            const plainFrames = toPlainFrames(fixture.frames);
            // Wire the AV seam BEFORE requestCamera() so the very first runAVFrame tick already
            // reads fixture bytes instead of the fake device's own synthetic tone.
            await page.evaluate((frames) => {
                window.__vacAvFixtureFrameIdx = 0;
                window.__vacTestAvAudioFill = function (tdBuf, freqBuf) {
                    var i = Math.min(window.__vacAvFixtureFrameIdx, frames.length - 1);
                    var f = frames[i];
                    for (var k = 0; k < tdBuf.length; k++) tdBuf[k] = f.tdBuf[k % f.tdBuf.length];
                    if (freqBuf) { for (var k = 0; k < freqBuf.length; k++) freqBuf[k] = f.freqBuf[k % f.freqBuf.length]; }
                    window.__vacAvFixtureFrameIdx++;
                };
            }, plainFrames);

            await page.evaluate(() => { try { window.requestCamera(); } catch (e) {} });
            await page.waitForFunction(() => {
                var v = document.getElementById('videoPreview');
                return v && v.readyState >= 2;
            }, { timeout: 10000 }).catch(() => {});

            const avArmed = await page.evaluate(() => (window.__vacAvFixtureFrameIdx || 0) > 0);

            const pillGreen = await page.waitForFunction(() => {
                var pill = document.getElementById('avPillMic');
                return pill && pill.classList.contains('good');
            }, { timeout: 12000 }).then(() => true).catch(() => false);

            expect(avArmed, `harness setup failed to reach the AV mic-qualify block (avAnalyser never read fixture frames) — ` +
                `cannot conclude anything about ${name}`).toBe(true);

            if (fixture.expectedOutcome === 'MIC_GREENS') {
                expect(pillGreen, `${name}: expected #avPillMic to green (bona fide near-field voice) but it did not`).toBe(true);
            } else if (fixture.expectedOutcome === 'MIC_RED') {
                expect(pillGreen, `${name}: expected #avPillMic to stay red (non-voice signal rejected) but it greened`).toBe(false);
            } else {
                test.info().annotations.push({ type: 'F-1139 result', description: `${name}: mic pill ${pillGreen ? 'GREENED' : 'stayed RED'} (documents current behavior, no pass/fail asserted)` });
            }
        });
    }
});
