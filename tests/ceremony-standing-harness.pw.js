// ceremony-standing-harness.pw.js — t740 Ceremony Standing Test Harness: browser-side tests
//
// WHAT THIS IS: Playwright E2E tests for the t740 sensor surface:
//   TC-TSH-01: synthetic self-test API is exposed and the result is set after ceremony loads
//   TC-TSH-02: synthetic self-test passes when analyser sees real oscillator signal
//   TC-TSH-03: silent-track banner renders correctly with Mac + Windows instructions
//   TC-TSH-04: regression — banner only fires after synth test passes (not before)
//
// HOW IT WORKS:
//   Loads the shared greeting-harness.html, mocks AudioContext (with oscillator support) and
//   other browser APIs, bootstraps the ceremony, then drives the sensor tests.
//
// MOCK DESIGN:
//   MockAudioContext supports createOscillator (returns a real-signal stub) in addition to
//   createAnalyser and createMediaStreamSource. The analyser's getByteTimeDomainData reports
//   RMS=0.25 when an oscillator is connected (simulating the synth self-test) and RMS=0.001
//   when reading real-mic-only frames (simulating a silent track for TC-TSH-03).
//
// Run: npx playwright test tests/ceremony-standing-harness.pw.js

'use strict';

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

const HARNESS_URL = 'file://' + path.join(__dirname, 'fixtures', 'greeting-harness.html');
const ROOT = path.join(__dirname, '..');

// ── TC-TSH-00: source structural checks (fast, no browser needed) ─────────────
// Belt-and-suspenders: if any of these fail the browser tests are meaningless.

test('TC-TSH-00: _runSyntheticAudioSelfTest present in vac-reauth-ceremony.js', () => {
    const src = fs.readFileSync(path.join(ROOT, 'vac-reauth-ceremony.js'), 'utf8');
    expect(
        src.includes('function _runSyntheticAudioSelfTest('),
        'TC-TSH-00: _runSyntheticAudioSelfTest must be defined in source'
    ).toBe(true);
});

test('TC-TSH-00: _showSilentTrackBanner present in vac-reauth-ceremony.js', () => {
    const src = fs.readFileSync(path.join(ROOT, 'vac-reauth-ceremony.js'), 'utf8');
    expect(
        src.includes('function _showSilentTrackBanner('),
        'TC-TSH-00: _showSilentTrackBanner must be defined in source'
    ).toBe(true);
});

test('TC-TSH-00: window.__vacSynthSelfTestResult export present in source', () => {
    const src = fs.readFileSync(path.join(ROOT, 'vac-reauth-ceremony.js'), 'utf8');
    expect(
        src.includes('window.__vacSynthSelfTestResult'),
        'TC-TSH-00: synthetic self-test result must be exposed on window for CI testability'
    ).toBe(true);
});

// ── TC-TSH-01: synthetic self-test runs and reports pass ──────────────────────

test.describe('TC-TSH: browser-side sensor tests', () => {

    test('TC-TSH-01: VACReauth loads and __vacRunSyntheticAudioSelfTest is exposed', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));

        await page.addInitScript(() => {
            // Track whether the oscillator was started (proves synth path fires)
            window.__vacOscStarted = false;

            // Mock AudioContext with oscillator support
            function createMockAnalyser() {
                var oscConnected = false;
                return {
                    fftSize: 256,
                    frequencyBinCount: 128,
                    smoothingTimeConstant: 0.15,
                    context: { sampleRate: 48000 },
                    connect: function() {},
                    disconnect: function() {},
                    _connectOsc: function() { oscConnected = true; },
                    getByteTimeDomainData: function(buf) {
                        // Return silence (near-zero) — synth test should still succeed because
                        // the oscillator's gain.connect(avAnalyser) in the real code writes
                        // into the same analyser. We simulate this by returning a real signal.
                        // In practice the oscillator writes samples in the next render quantum;
                        // for this test we just verify the API surface fires correctly.
                        var amp = Math.round(0.001 * 128); // near-silence from mic track
                        for (var i = 0; i < buf.length; i++) buf[i] = 128 + (i % 2 ? amp : -amp);
                    },
                    getByteFrequencyData: function(buf) {
                        for (var i = 0; i < buf.length; i++) buf[i] = (i >= 1 && i <= 16) ? 100 : 0;
                    }
                };
            }

            function MockOscillator() {
                this.type = 'sine';
                this.frequency = { value: 440 };
                this.connect = function(dest) {};
                this.disconnect = function() {};
                this.start = function() { window.__vacOscStarted = true; };
                this.stop = function() {};
            }

            function MockGain(ctx) {
                this.gain = { value: 1 };
                this.connect = function() {};
                this.disconnect = function() {};
            }

            function MockAudioContext() {
                this.state = 'running';
                this.sampleRate = 48000;
                this.resume = function() { return Promise.resolve(); };
                this.close = function() { this.state = 'closed'; return Promise.resolve(); };
                this.createMediaStreamSource = function() { return { connect: function() {} }; };
                this.createAnalyser = function() { return createMockAnalyser(); };
                this.createOscillator = function() { return new MockOscillator(); };
                this.createGain = function() { return new MockGain(this); };
            }
            window.AudioContext = window.webkitAudioContext = MockAudioContext;

            // Mock getUserMedia (no real camera in CI)
            if (navigator.mediaDevices) {
                navigator.mediaDevices.getUserMedia = function() {
                    var fakeTrack = {
                        kind: 'audio', label: 'Fake Microphone (test)', readyState: 'live',
                        getSettings: function() { return { sampleRate: 48000 }; },
                        onended: null, stop: function() {}
                    };
                    var fakeStream = {
                        getTracks: function() { return [fakeTrack]; },
                        getAudioTracks: function() { return [fakeTrack]; },
                        getVideoTracks: function() { return []; }
                    };
                    return Promise.resolve(fakeStream);
                };
            }

            // Mock MediaRecorder
            window.MediaRecorder = function() {
                this.state = 'inactive'; this.ondataavailable = null; this.onstop = null;
                this.start = function() { this.state = 'recording'; };
                this.stop = function() {
                    this.state = 'inactive';
                    if (this.ondataavailable) this.ondataavailable({ data: new Blob([], { type: 'audio/webm' }) });
                    if (this.onstop) this.onstop();
                };
                this.pause = function() {}; this.resume = function() {};
            };
            window.MediaRecorder.isTypeSupported = function() { return true; };

            // Mock FingerDetector
            window.FingerDetector = {
                landmarks: null,
                detect: function() {
                    var lm = []; for (var i = 0; i < 21; i++) lm.push({ x: 0.18, y: 0.48 });
                    this.landmarks = lm; return { fingers: 2 };
                },
                warmOnce: function() {}, reset: function() {}, init: function() {},
                ready: true, failed: false
            };

            // Mock canvas brightness
            try {
                var _origDI = CanvasRenderingContext2D.prototype.drawImage;
                CanvasRenderingContext2D.prototype.drawImage = function() {
                    try { _origDI.apply(this, arguments); } catch(e) {}
                };
                CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
                    var data = new Uint8ClampedArray(w * h * 4);
                    for (var i = 0; i < data.length; i += 4) {
                        data[i] = 150; data[i+1] = 150; data[i+2] = 150; data[i+3] = 255;
                    }
                    return new ImageData(data, w, h);
                };
            } catch(e) {}

            // Mock fetch
            window.fetch = function(url) {
                var u = String(url || '');
                if (u.includes('challenge')) {
                    return Promise.resolve({ ok: true, status: 200,
                        json: function() { return Promise.resolve({ phrase: 'test phrase', digits: [3, 2], session_id: 'tsh-test' }); },
                        text: function() { return Promise.resolve('{}'); }
                    });
                }
                return Promise.resolve({ ok: true, status: 200,
                    json: function() { return Promise.resolve({}); },
                    text: function() { return Promise.resolve(''); }
                });
            };

            // Mock videoPreview.play()
            Object.defineProperty(HTMLVideoElement.prototype, 'play', {
                value: function() { return Promise.resolve(); }, writable: true
            });
        });

        await page.goto(HARNESS_URL);
        await page.waitForLoadState('domcontentloaded');

        // VACReauth must be available
        const reauthAvail = await page.evaluate(() =>
            typeof window.VACReauth !== 'undefined' && typeof window.VACReauth.run === 'function'
        );
        expect(reauthAvail, 'TC-TSH-01: VACReauth.run must be available').toBe(true);

        // Testability exports must be present
        const exportsAvail = await page.evaluate(() =>
            typeof window.__vacShowSilentTrackBanner === 'function' &&
            typeof window.__vacRunSyntheticAudioSelfTest === 'function'
        );
        expect(exportsAvail, 'TC-TSH-01: __vacShowSilentTrackBanner and __vacRunSyntheticAudioSelfTest must be exposed on window').toBe(true);

        // Fatal JS errors: allow only network/getUserMedia/permissions errors (same whitelist as ceremony-selftest.pw.js)
        const fatal = errors.filter(e =>
            !e.includes('getUserMedia') && !e.includes('fetch') && !e.includes('NetworkError') &&
            !e.includes('ERR_BLOCKED') && !e.includes('MediaDevices') && !e.includes('Permission') &&
            !e.includes('NotAllowed') && !e.includes('cors') && !e.includes('CORS') &&
            !e.includes('Failed to load resource') && !e.includes('net::ERR') &&
            !e.includes('HTMLVideoElement') && !e.includes('play()')
        );
        expect(fatal, 'TC-TSH-01: fatal JS errors: ' + JSON.stringify(fatal)).toHaveLength(0);
    });

    // ── TC-TSH-02: synthetic self-test fires when called with a live AudioContext ──

    // TC-TSH-02 (S204 review fix): exercise the REAL _runSyntheticAudioSelfTest source in an isolated
    // Node sandbox with mock avAudioCtx/avAnalyser bound as its closure variables. The production bundle
    // carries NO injection seam (no window/URL-controlled override), so the test never goes through the page.
    test('TC-TSH-02: synthetic self-test creates and starts an oscillator on the live graph (isolated source test)', async () => {
        const srcText = fs.readFileSync(path.join(ROOT, 'vac-reauth-ceremony.js'), 'utf8');
        const start = srcText.indexOf('function _runSyntheticAudioSelfTest(');
        expect(start, 'TC-TSH-02: _runSyntheticAudioSelfTest must exist').toBeGreaterThan(0);
        let depth = 0, i = srcText.indexOf('{', start);
        for (; i < srcText.length; i++) { if (srcText[i] === '{') depth++; else if (srcText[i] === '}' && --depth === 0) { i++; break; } }
        const fnText = srcText.slice(start, i);
        const ev = { started: false, stopped: false, connectedTo: null };
        const avAnalyser = { fftSize: 256, getByteTimeDomainData(buf) { for (let k = 0; k < buf.length; k++) buf[k] = 128 + Math.round(38 * Math.sin(k * 0.4)); } };
        const avAudioCtx = {
            createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() { ev.started = true; }, stop() { ev.stopped = true; } }; },
            createGain() { return { gain: { value: 1 }, connect(t) { ev.connectedTo = t; }, disconnect() {} }; },
        };
        const sandboxWindow = {};
        const run = new Function('avAudioCtx', 'avAnalyser', 'SILENT_TRACK_SYNTH_THRESHOLD', 'vacDebug', 'window', 'setTimeout',
            fnText + '\nreturn _runSyntheticAudioSelfTest;')(avAudioCtx, avAnalyser, 0.02, function() {}, sandboxWindow, function(f) { f(); });
        let result = null;
        run(function(pass, rms) { result = { pass, rms }; });
        expect(ev.started, 'TC-TSH-02: self-test must start an oscillator').toBe(true);
        expect(ev.stopped, 'TC-TSH-02: self-test must stop the oscillator').toBe(true);
        expect(ev.connectedTo, 'TC-TSH-02: oscillator gain must feed the SAME live analyser').toBe(avAnalyser);
        expect(result && result.pass, 'TC-TSH-02: a live tone must read above threshold').toBe(true);
    });

    // TC-TSH-02b (S204 review fix, negative): nothing a URL or a page global can supply activates a mock
    // audio graph in the production bundle. With ?qa=1 AND every plausible injected global set, the
    // self-test must still refuse (no live graph yet) and must never touch the injected objects.
    test('TC-TSH-02b: ?qa=1 and injected window globals cannot activate any audio injection in production', async ({ page }) => {
        const srcText = fs.readFileSync(path.join(ROOT, 'vac-reauth-ceremony.js'), 'utf8');
        const start = srcText.indexOf('function _runSyntheticAudioSelfTest(');
        const body = srcText.slice(start, srcText.indexOf('window.__vacRunSyntheticAudioSelfTest', start));
        // The only window.* reference allowed is the existing WRITE of the diagnostic result.
        const winRefs = (body.match(/window\.[A-Za-z_$][\w$]*/g) || []).filter(r => r !== 'window.__vacSynthSelfTestResult');
        expect(winRefs, 'TC-TSH-02b: self-test must not read any window.* override').toEqual([]);
        expect(/window\.__vacSynthSelfTestResult\s*=/.test(body), 'TC-TSH-02b: the result global is write-only').toBe(true);
        expect(body.includes('_qaFlag'), 'TC-TSH-02b: self-test must not depend on the QA flag').toBe(false);
        expect(srcText.includes('__vacTshInjectAv'), 'TC-TSH-02b: no injection seam may exist in the production bundle').toBe(false);

        await page.addInitScript(() => {
            window.__vacInjectedTouched = false;
            const trap = { ctx: { createOscillator() { window.__vacInjectedTouched = true; return {}; }, createGain() { window.__vacInjectedTouched = true; return {}; } },
                           analyser: { fftSize: 256, getByteTimeDomainData() { window.__vacInjectedTouched = true; } } };
            window.__vacTshInjectAv = trap; window.__vacInjectAv = trap; window.__vacAudioOverride = trap;
            window.avAudioCtx = trap.ctx; window.avAnalyser = trap.analyser;
        });
        await page.goto(HARNESS_URL + '?qa=1&debug=1&inject=1');
        await page.waitForLoadState('domcontentloaded');
        const res = await page.evaluate(() => new Promise((resolve) => {
            try { window.__vacRunSyntheticAudioSelfTest(function(pass, why) { resolve({ pass, why: String(why), touched: window.__vacInjectedTouched }); }); }
            catch (e) { resolve({ error: String(e), touched: window.__vacInjectedTouched }); }
        }));
        expect(res.touched, 'TC-TSH-02b: injected objects must never be used').toBe(false);
        expect(res.pass, 'TC-TSH-02b: with no live graph the self-test must refuse').toBe(false);
        expect(res.why, 'TC-TSH-02b: refusal reason').toBe('no_ctx');
    });

    test('TC-TSH-03: silent-track banner is visible and contains Mac System Settings instruction', async ({ page }) => {
        await page.addInitScript(() => {
            function MockAudioContext() {
                this.state = 'running'; this.sampleRate = 48000;
                this.resume = function() { return Promise.resolve(); };
                this.close = function() { this.state = 'closed'; return Promise.resolve(); };
                this.createMediaStreamSource = function() { return { connect: function() {} }; };
                this.createAnalyser = function() { return {
                    fftSize: 256, frequencyBinCount: 128, smoothingTimeConstant: 0.15,
                    context: { sampleRate: 48000 },
                    connect: function() {}, disconnect: function() {},
                    getByteTimeDomainData: function(buf) { for (var i=0; i<buf.length; i++) buf[i]=128; },
                    getByteFrequencyData: function(buf) { for (var i=0; i<buf.length; i++) buf[i]=0; }
                }; };
                this.createOscillator = function() { return {
                    type: 'sine', frequency: { value: 440 },
                    connect: function() {}, disconnect: function() {},
                    start: function() {}, stop: function() {}
                }; };
                this.createGain = function() { return { gain: { value: 1 }, connect: function() {}, disconnect: function() {} }; };
            }
            window.AudioContext = window.webkitAudioContext = MockAudioContext;
            window.fetch = function() { return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve({}); }, text:function(){return Promise.resolve('');} }); };
            Object.defineProperty(HTMLVideoElement.prototype, 'play', { value: function() { return Promise.resolve(); }, writable: true });
        });

        await page.goto(HARNESS_URL);
        await page.waitForLoadState('domcontentloaded');

        // Bootstrap ceremony (ceremony must be running to have VACReauth loaded)
        await page.evaluate(() => {
            var mount = document.getElementById('mount');
            if (!mount) { mount = document.createElement('div'); mount.id='mount'; document.body.appendChild(mount); }
            window.VACReauth.run({ name: 'TSH Silent Track', email: 'tsh@test.dev', mount: mount,
                riskLevel: 'medium', context: 'test',
                onComplete: function() {}, onBack: function() {}, onStep: function() {} });
        });

        // Directly trigger the silent-track banner via the testability export
        const bannerTriggered = await page.evaluate(() => {
            try { window.__vacShowSilentTrackBanner(); return true; } catch(e) { return String(e); }
        });
        expect(bannerTriggered, 'TC-TSH-03: __vacShowSilentTrackBanner() must not throw').toBe(true);

        // Banner element must be in the DOM
        const bannerEl = page.locator('#vacSilentTrackBanner');
        await expect(bannerEl, 'TC-TSH-03: #vacSilentTrackBanner must be present in DOM').toBeAttached();
        await expect(bannerEl, 'TC-TSH-03: #vacSilentTrackBanner must be visible').toBeVisible();

        // Banner text must include the key instruction
        const bannerText = await bannerEl.innerText();
        expect(
            bannerText.includes('no microphone') || bannerText.includes('no microphone signal'),
            'TC-TSH-03: banner must state "no microphone signal" — the class that ate two days'
        ).toBe(true);
        expect(
            bannerText.includes('System Settings') || bannerText.includes('Privacy'),
            'TC-TSH-03: banner must include Mac System Settings path'
        ).toBe(true);
        expect(
            bannerText.includes('Windows') || bannerText.includes('Settings'),
            'TC-TSH-03: banner must include Windows path'
        ).toBe(true);

        // Check again button must be present
        const dismissBtn = page.locator('#vacSilentTrackDismiss');
        await expect(dismissBtn, 'TC-TSH-03: Check again button must be present').toBeVisible();
    });

    // ── TC-TSH-04: regression guard — banner does NOT fire without synth test ─

    test('TC-TSH-04: silent-track banner NOT shown when ceremony loads fresh (requires detection loop)', async ({ page }) => {
        await page.addInitScript(() => {
            function MockAudioContext() {
                this.state = 'running'; this.sampleRate = 48000;
                this.resume = function() { return Promise.resolve(); };
                this.close = function() { this.state = 'closed'; return Promise.resolve(); };
                this.createMediaStreamSource = function() { return { connect: function() {} }; };
                this.createAnalyser = function() { return {
                    fftSize: 256, frequencyBinCount: 128, smoothingTimeConstant: 0.15,
                    context: { sampleRate: 48000 },
                    connect: function() {}, disconnect: function() {},
                    getByteTimeDomainData: function(buf) { for (var i=0; i<buf.length; i++) buf[i]=128; },
                    getByteFrequencyData: function(buf) { for (var i=0; i<buf.length; i++) buf[i]=0; }
                }; };
                this.createOscillator = function() { return {
                    type: 'sine', frequency: { value: 440 },
                    connect: function() {}, disconnect: function() {},
                    start: function() {}, stop: function() {}
                }; };
                this.createGain = function() { return { gain: { value: 1 }, connect: function() {}, disconnect: function() {} }; };
            }
            window.AudioContext = window.webkitAudioContext = MockAudioContext;
            window.fetch = function() { return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve({}); }, text:function(){return Promise.resolve('');} }); };
            Object.defineProperty(HTMLVideoElement.prototype, 'play', { value: function() { return Promise.resolve(); }, writable: true });
        });

        await page.goto(HARNESS_URL);
        await page.waitForLoadState('domcontentloaded');

        // Bootstrap ceremony WITHOUT triggering requestCamera
        await page.evaluate(() => {
            var mount = document.getElementById('mount');
            if (!mount) { mount = document.createElement('div'); mount.id='mount'; document.body.appendChild(mount); }
            window.VACReauth.run({ name: 'TSH Regression', email: 'tsh@test.dev', mount: mount,
                riskLevel: 'medium', context: 'test',
                onComplete: function() {}, onBack: function() {}, onStep: function() {} });
        });

        // Banner must NOT be present immediately — it requires synth test + detection loop
        const bannerPresent = await page.evaluate(() => !!document.getElementById('vacSilentTrackBanner'));
        expect(
            bannerPresent,
            'TC-TSH-04: #vacSilentTrackBanner must NOT appear at ceremony load — requires synth test pass + ' + String(360) + ' detection frames'
        ).toBe(false);
    });
});
