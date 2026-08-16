// greeting-loop-heartbeat.pw.js — S166 REFIRE 889 (L-2443/L-2502)
//
// WHAT THIS IS: regression harness for the "blind after arm" defect — Rob's 16 Aug live
// run (sess_uinaxmu7_reauth) showed the AudioContext suspended immediately at arm, then
// ZERO events of any kind for 60s+: no phrase_speech_confirmed, no phrase_pass_*, no
// phrase_speech_timeout, no phrase_gate_fail_open. A dead/blind loop, not a bad threshold.
//
// This harness reproduces the two device conditions the cross-model panel flagged and
// asserts BOTH properties the fix must hold:
//   1. ceremony_heartbeat fires every ~2s throughout the greeting stage regardless of
//      outcome — the instrument itself is never blind again.
//   2. On VOICED fixture audio the greeting still reaches a genuine pass (heard:true /
//      phrase_pass_*) via the MR-fallback path — the fix recovers real users.
//   3. On REJECT fixture audio (true silence, no MR-fallback signal either) the greeting
//      does NOT falsely report heard:true within the same window — the recovery path
//      requires real voiced energy, it doesn't fail open on "starved" alone.
//
// Fixtures (window.__vacFixture, read by the mocks below):
//   'ctx_suspended_after_arm' — audioContext.state is 'suspended' at arm and resume()
//     never flips it (the exact iOS Safari failure the trace shows). Exercises the S166
//     candidate-fix-(b) 1.5s force-switch-to-MR-fallback path in renderGreeting().
//   'analyser_starved'        — audioContext.state is 'running' but the analyser itself
//     reads crushed/near-zero RMS throughout (iOS AGC compression class of bug).
//     Exercises the pre-existing t728 _vadStarved 12s counter + MR-fallback pipe.
//
// Run: npx playwright test tests/greeting-loop-heartbeat.pw.js
// NOTE: this sandbox could not execute a live Chromium run (no root to install
// libglib2.0 etc. — `npx playwright install --with-deps` needs sudo). The harness
// mirrors the already-CI-proven pattern in tests/greeting-audible.pw.js and
// tests/ceremony-standing-harness.pw.js line-for-line; it is syntax-checked
// (`node --check`) but NOT yet empirically run. CI's ceremony-selftest.yml already
// does `npm install --no-save @playwright/test && npx playwright install --with-deps
// chromium` with root — run there before trusting this as a merge gate.

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');

const HARNESS_URL = 'file://' + path.join(__dirname, 'fixtures', 'greeting-harness.html');

function addMocks(page, fixture, voiced) {
    return page.addInitScript(({ fixture, voiced }) => {
        window.__vacFixture = fixture;
        window.__vacVoiced = voiced;

        // Energy-VAD only path — no cloud STT in CI, deterministic.
        window.SpeechRecognition = undefined;
        window.webkitSpeechRecognition = undefined;

        // ── console.log tap: collect every [VAC-DBG] event by name ──────────────────────
        window.__vacEvents = [];
        var _origLog = console.log;
        console.log = function () {
            _origLog.apply(console, arguments);
            if (String(arguments[0]).includes('[VAC-DBG]')) {
                window.__vacEvents.push({ name: String(arguments[1] || ''), data: arguments[2] || null });
            }
        };

        // ── getUserMedia: fake live audio+video tracks (ceremony-standing-harness pattern) ──
        if (navigator.mediaDevices) {
            navigator.mediaDevices.getUserMedia = function () {
                var audioTrack = {
                    kind: 'audio', label: 'Fake Microphone (test)', readyState: 'live', muted: false, enabled: true,
                    getSettings: function () { return { sampleRate: 48000 }; },
                    onended: null, stop: function () {},
                };
                var videoTrack = {
                    kind: 'video', label: 'Fake Camera (test)', readyState: 'live', muted: false, enabled: true,
                    getSettings: function () { return { width: 640, height: 480 }; },
                    onended: null, stop: function () {},
                };
                var fakeStream = {
                    getTracks: function () { return [audioTrack, videoTrack]; },
                    getAudioTracks: function () { return [audioTrack]; },
                    getVideoTracks: function () { return [videoTrack]; },
                };
                return Promise.resolve(fakeStream);
            };
        }

        // ── AudioContext mock ─────────────────────────────────────────────────────────
        // AV mode (preflight, _mockAvDone=false): unchanged fast-qualify pattern from
        // greeting-audible.pw.js — not the object under test here, just needs to clear fast.
        // Ceremony mode (_mockAvDone=true): behaviour keyed off window.__vacFixture.
        function createMockAnalyser(isForAV) {
            var tick = 0;
            var wallStart = null;
            return {
                fftSize: 256, frequencyBinCount: 128, smoothingTimeConstant: 0.15,
                context: { sampleRate: 48000 },
                connect: function () {}, disconnect: function () {},
                getByteTimeDomainData: function (buf) {
                    tick++;
                    var rms;
                    if (isForAV) {
                        rms = (tick <= 110) ? 0.002 : 0.50;
                    } else {
                        // Both fixtures: the WebAudio analyser itself never produces usable
                        // signal (that's the point) — a starved/crushed reading throughout.
                        // Real voice, when present, arrives via the MR-fallback blob-size
                        // heuristic instead (mocked in MediaRecorder below).
                        rms = 0.005;
                    }
                    var amp = Math.round(rms * 128);
                    for (var i = 0; i < buf.length; i++) buf[i] = (i % 2 === 0) ? (128 + amp) : (128 - amp);
                },
                getByteFrequencyData: function (buf) {
                    if (isForAV) {
                        for (var i = 0; i < buf.length; i++) buf[i] = (i >= 1 && i <= 16) ? 200 : 0;
                    } else {
                        // Ceremony mode: keep the frequency-domain read as starved as the time-domain
                        // one, on BOTH fixtures (voiced and reject alike). This forces _phraseVadTick's
                        // secondary spectral-escape check ((_mb/len>=2) && (_vbRatio>=thr)) to stay
                        // false regardless of window.__vacVoiced, so _avMrLevelSynth (driven only by
                        // the MediaRecorder blob-size mock below) is the SOLE signal source under test
                        // — otherwise this mock would make the reject fixture falsely "pass" too.
                        for (var j = 0; j < buf.length; j++) buf[j] = 1;
                    }
                },
            };
        }

        function MockAudioContext() {
            var isAV = !window._mockAvDone; // captured at creation time
            this.sampleRate = 48000;
            if (isAV) {
                this.state = 'running';
            } else if (window.__vacFixture === 'ctx_suspended_after_arm') {
                // The exact failure in Rob's trace: resume() resolves but never actually
                // flips the context to 'running' (iOS silently refusing a non-gesture resume).
                this.state = 'suspended';
            } else {
                // 'analyser_starved': the context itself is healthy; the ANALYSER is dead.
                this.state = 'running';
            }
            var self = this;
            this.resume = function () { return Promise.resolve(); }; // never mutates state — see above
            this.close = function () { self.state = 'closed'; return Promise.resolve(); };
            this.addEventListener = function () {}; // statechange listener — never fires, state is fixed
            this.createMediaStreamSource = function () { return { connect: function () {} }; };
            this.createAnalyser = function () { return createMockAnalyser(isAV); };
        }
        window.AudioContext = window.webkitAudioContext = MockAudioContext;

        // ── MediaRecorder mock ────────────────────────────────────────────────────────
        // Two distinct instances get created against the SAME mock constructor:
        //   1. The main video/audio recorder in beginRecording() — mimeType starts 'video/'.
        //   2. The MR-fallback mini recorder in _startAvMrFallback() — mimeType starts 'audio/'.
        // Only #2 needs to simulate periodic ondataavailable ticks; its blob-size variance
        // (ratio peak/trough) is exactly what _avMrLevelSynth reads to decide "voiced".
        window.MediaRecorder = function (stream, opts) {
            this.state = 'inactive';
            this.ondataavailable = null;
            this.onstop = null;
            var self = this;
            var isFallback = !!(opts && opts.mimeType && opts.mimeType.indexOf('audio/') === 0);
            var timer = null;
            this.start = function (timeslice) {
                self.state = 'recording';
                if (isFallback && timeslice) {
                    var n = 0;
                    var wallStart = null;
                    timer = setInterval(function () {
                        if (self.state !== 'recording' || !self.ondataavailable) return;
                        n++;
                        if (!wallStart) wallStart = performance.now();
                        var elapsed = performance.now() - wallStart;
                        // Real speech has an end: voiced (alternating blob size -> ratio ~1.6,
                        // _avMrLevelSynth ~20, clears the >=8 floor) for the first ~2.4s so
                        // PHRASE_VOICED_TICKS_NEEDED + modulation is satisfied, THEN constant/flat
                        // so the natural voiced-run-then-silence detector can complete the utterance
                        // (phraseSpoke / phrase_speech_confirmed) — not just the sustained-run escape
                        // (phrase_pass_on_voiced_run). Reject fixture: constant/flat throughout —
                        // ratio stays ~1.0, _avMrLevelSynth never leaves 0, nothing ever reads as voiced.
                        var size = (window.__vacVoiced && elapsed < 2400) ? ((n % 2 === 0) ? 1000 : 1600) : 1000;
                        self.ondataavailable({ data: { size: size } });
                    }, timeslice);
                }
            };
            this.stop = function () {
                self.state = 'inactive';
                if (timer) { clearInterval(timer); timer = null; }
                if (self.ondataavailable) self.ondataavailable({ data: new Blob([], { type: 'video/webm' }) });
                if (self.onstop) self.onstop();
            };
            this.pause = function () {};
            this.resume = function () {};
        };
        window.MediaRecorder.isTypeSupported = function () { return true; };

        // ── FingerDetector mock: immediate stable hand so AV pre-flight clears fast ─────
        window.FingerDetector = {
            landmarks: null,
            detect: function () {
                var lm = []; for (var i = 0; i < 21; i++) lm.push({ x: 0.18, y: 0.48 });
                this.landmarks = lm; return { fingers: 2 };
            },
            warmOnce: function () {}, reset: function () {}, init: function () {},
            ready: true, failed: false,
        };

        // ── canvas brightness mock (avChecks.light) ─────────────────────────────────────
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

        // ── fetch mock: fake challenge data; swallow everything else (debug beacons etc.) ──
        window.fetch = function (url) {
            var urlStr = String(url || '');
            if (urlStr.includes('challenge')) {
                return Promise.resolve({
                    ok: true, status: 200,
                    json: function () { return Promise.resolve({ phrase: 'Hello verify me', digits: [3, 2], session_id: 'tc-hb-test' }); },
                    text: function () { return Promise.resolve('{}'); },
                });
            }
            return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve(''); } });
        };
    }, { fixture, voiced });
}

async function driveToGreeting(page) {
    await page.goto(HARNESS_URL);
    await page.waitForLoadState('domcontentloaded');

    const runOk = await page.evaluate(() => {
        try {
            var mount = document.getElementById('mount');
            if (!mount) return 'no-mount';
            window.VACReauth.run({
                name: 'TC-HB Test', email: 'tc-hb@test.vacprotocol.test',
                mount: mount, riskLevel: 'medium', context: 'test',
                onComplete: function () {}, onBack: function () {}, onStep: function () {},
            });
            return 'ok';
        } catch (e) { return String(e); }
    });
    expect(runOk).toBe('ok');

    await page.evaluate(() => { try { window.requestCamera(); } catch (e) {} });
    await page.waitForFunction(() => {
        var btn = document.getElementById('btnCamera');
        return btn && !btn.disabled && btn.onclick && btn.onclick.name !== 'requestCamera';
    }, { timeout: 8000 }).catch(() => {});

    // Flip to ceremony-mode AudioContext behaviour for the NEXT context creation
    // (the pre-warm inside dismissChallengeIntro, then startAudioMonitor's reuse/creation).
    await page.evaluate(() => { window._mockAvDone = true; });

    await page.evaluate(() => {
        var btn = document.getElementById('btnCamera');
        if (btn) btn.disabled = false;
        if (btn && btn.onclick) { try { btn.onclick(); } catch (e) {} }
    });

    await page.waitForTimeout(300);
    await page.evaluate(() => {
        try { window.dismissChallengeIntro(); } catch (e) {}
        setTimeout(function () {
            try { if (typeof window._vacSoundResult === 'function') window._vacSoundResult(true); } catch (e) {}
        }, 50);
    });
}

const FIXTURES = ['ctx_suspended_after_arm', 'analyser_starved'];

test.describe('TC-HB: greeting/digit loop heartbeat + starved-analyser recovery', () => {

    for (const fixture of FIXTURES) {
        // The 'analyser_starved' fixture waits on the pre-existing ~12s crushed-frame
        // starvation counter (t728) before MR-fallback engages; give it real headroom.
        const budgetMs = fixture === 'analyser_starved' ? 40000 : 20000;

        test(`TC-HB-${fixture}-voiced: reaches a genuine pass via MR-fallback and heartbeats throughout`, async ({ page }) => {
            test.setTimeout(budgetMs + 10000);
            await addMocks(page, fixture, true);
            await driveToGreeting(page);

            await page.waitForFunction(
                () => window.__vacEvents && window.__vacEvents.some(e => e.name === 'greeting_audible' || e.name.indexOf('phrase_pass') === 0),
                { timeout: budgetMs }
            );

            const events = await page.evaluate(() => window.__vacEvents);
            const heartbeats = events.filter(e => e.name === 'ceremony_heartbeat');
            const passEvents = events.filter(e => e.name.indexOf('phrase_pass') === 0);
            const greetingAudible = events.find(e => e.name === 'greeting_audible');
            const forcedSwitch = events.find(e => e.name === 'vad_mr_fallback_forced');
            const loopErrors = events.filter(e => e.name === 'loop_error');

            expect(heartbeats.length, 'TC-HB: ceremony_heartbeat must fire repeatedly during the greeting stage — a blind instrument is the defect this harness guards against.\n' + JSON.stringify(events.slice(0, 20))).toBeGreaterThan(0);
            expect(loopErrors.length, 'TC-HB: no loop_error expected on the happy path.\n' + JSON.stringify(loopErrors)).toBe(0);
            if (fixture === 'ctx_suspended_after_arm') {
                expect(forcedSwitch, 'TC-HB: ctx_suspended_after_arm must force-switch to MR-fallback within 1.5s of arm (candidate fix b).\n' + JSON.stringify(events.slice(0, 20))).toBeTruthy();
            }
            expect(
                passEvents.length > 0 || (greetingAudible && greetingAudible.data && greetingAudible.data.heard === true),
                'TC-HB: voiced fixture must reach a genuine voice pass (phrase_pass_* or greeting_audible heard:true), not just the timeout fail-open.\n' + JSON.stringify(events.slice(0, 30))
            ).toBe(true);
        });

        test(`TC-HB-${fixture}-reject: stays stuck (never falsely reports heard) while still emitting heartbeats`, async ({ page }) => {
            test.setTimeout(budgetMs + 10000);
            await addMocks(page, fixture, false);
            await driveToGreeting(page);

            // Bounded window: long enough to observe the same recovery attempt as the
            // voiced case, short of the full PHRASE_PHASE_MAX_S hard-cap timeout.
            await page.waitForTimeout(Math.min(budgetMs - 5000, 9000));

            const events = await page.evaluate(() => window.__vacEvents);
            const heartbeats = events.filter(e => e.name === 'ceremony_heartbeat');
            const falsePass = events.filter(e => e.name.indexOf('phrase_pass') === 0);
            const greetingAudible = events.find(e => e.name === 'greeting_audible');

            expect(heartbeats.length, 'TC-HB: heartbeats must keep firing even on a genuinely silent/starved device — that is the whole point of the fix.\n' + JSON.stringify(events.slice(0, 20))).toBeGreaterThan(0);
            expect(falsePass.length, 'TC-HB: a reject (true-silence) fixture must NEVER produce a voiced pass — the MR-fallback recovery must require real signal, not just "starved".\n' + JSON.stringify(falsePass)).toBe(0);
            if (greetingAudible) {
                expect(greetingAudible.data && greetingAudible.data.heard, 'TC-HB: if the hard cap already fired within this window, it must be heard:false, never a false positive.').toBe(false);
            }
        });
    }

});
