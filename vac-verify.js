/**
 * VAC Verify Widget — Drop-in identity verification for any website
 * ================================================================
 * 
 * Usage:
 *   <script src="https://vacprotocol.org/vac-verify.js"></script>
 *   <script>
 *     VACVerify.init({
 *       apiKey: 'vac_...',
 *       onVerified: (result) => console.log('Verified!', result),
 *       onError: (err) => console.error(err),
 *     });
 *     
 *     // Show verification modal
 *     VACVerify.open();
 *   </script>
 * 
 * Patent: 558 claims across 12 filings. Violet Shores Pty Ltd.
 * Protocol: vacprotocol.org | SDK: vacprotocol.org/developers
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VACVerify = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const DEFAULT_API = 'https://vac-system-production.up.railway.app';
  const WIDGET_ID = 'vac-verify-widget';

  let _config = {
    apiKey: null,
    apiUrl: DEFAULT_API,
    assuranceLevel: 'L3',    // L1 (API key), L2 (OIDC), L3 (biometric)
    theme: 'dark',           // 'dark' or 'light'
    position: 'center',      // 'center', 'bottom-right'
    autoClose: true,
    closeOnVerified: true,
    locale: 'en',
    modalities: ['face', 'voice', 'gesture'],
    branding: null,          // { logo_url, primary_color, company_name }
    onVerified: null,
    onError: null,
    onClose: null,
    onChallenge: null,
  };

  let _state = {
    isOpen: false,
    challenge: null,
    sessionToken: null,
    recording: false,
    mediaRecorder: null,
    stream: null,
    videoChunks: [],
  };

  // ── Styles ─────────────────────────────────────────────────

  const STYLES = `
    #${WIDGET_ID} {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      z-index: 999999;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #${WIDGET_ID}.vac-open { display: flex; }
    #${WIDGET_ID} .vac-modal {
      background: #0D0F17;
      border: 1px solid rgba(45, 212, 191, 0.2);
      border-radius: 16px;
      width: 420px;
      max-width: 95vw;
      max-height: 90vh;
      overflow: hidden;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
    }
    #${WIDGET_ID} .vac-header {
      padding: 20px 24px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    #${WIDGET_ID} .vac-brand {
      color: #2DD4BF;
      font-family: monospace;
      font-size: 11px;
      letter-spacing: 3px;
      text-transform: uppercase;
    }
    #${WIDGET_ID} .vac-close {
      background: none;
      border: none;
      color: #6B7280;
      cursor: pointer;
      font-size: 20px;
      padding: 4px 8px;
      border-radius: 6px;
    }
    #${WIDGET_ID} .vac-close:hover { color: #fff; background: rgba(255,255,255,0.06); }
    #${WIDGET_ID} .vac-body { padding: 24px; }
    #${WIDGET_ID} .vac-title {
      color: #E6EDF3;
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    #${WIDGET_ID} .vac-subtitle {
      color: #9CA3AF;
      font-size: 14px;
      line-height: 1.5;
      margin-bottom: 20px;
    }
    #${WIDGET_ID} .vac-video-container {
      position: relative;
      width: 100%;
      aspect-ratio: 4/3;
      background: #000;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 16px;
    }
    #${WIDGET_ID} video {
      width: 100%; height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
    }
    #${WIDGET_ID} .vac-challenge {
      position: absolute;
      bottom: 12px; left: 12px; right: 12px;
      background: rgba(0, 0, 0, 0.7);
      border-radius: 8px;
      padding: 12px;
      color: #fff;
      font-size: 14px;
      text-align: center;
    }
    #${WIDGET_ID} .vac-challenge-phrase {
      color: #2DD4BF;
      font-weight: 600;
      font-size: 16px;
      margin-top: 4px;
    }
    #${WIDGET_ID} .vac-challenge-gesture {
      display: inline-block;
      background: #2DD4BF;
      color: #0D0F17;
      font-weight: 700;
      font-size: 28px;
      width: 48px; height: 48px;
      line-height: 48px;
      border-radius: 50%;
      margin-top: 8px;
    }
    #${WIDGET_ID} .vac-btn {
      width: 100%;
      padding: 14px;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    #${WIDGET_ID} .vac-btn-primary {
      background: #2DD4BF;
      color: #0D0F17;
    }
    #${WIDGET_ID} .vac-btn-primary:hover { background: #14B8A6; }
    #${WIDGET_ID} .vac-btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    #${WIDGET_ID} .vac-btn-recording {
      background: #EF4444;
      color: #fff;
      animation: vac-pulse 1.5s infinite;
    }
    @keyframes vac-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
      50% { box-shadow: 0 0 0 12px rgba(239, 68, 68, 0); }
    }
    #${WIDGET_ID} .vac-status {
      text-align: center;
      padding: 16px;
      color: #9CA3AF;
      font-size: 14px;
    }
    #${WIDGET_ID} .vac-success {
      text-align: center;
      padding: 32px 24px;
    }
    #${WIDGET_ID} .vac-success-icon {
      width: 64px; height: 64px;
      border-radius: 50%;
      background: rgba(45, 212, 191, 0.1);
      border: 2px solid #2DD4BF;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      font-size: 28px;
    }
    #${WIDGET_ID} .vac-success-title {
      color: #2DD4BF;
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    #${WIDGET_ID} .vac-success-score {
      color: #9CA3AF;
      font-size: 14px;
    }
    #${WIDGET_ID} .vac-footer {
      padding: 12px 24px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      text-align: center;
    }
    #${WIDGET_ID} .vac-powered {
      color: #4B5563;
      font-size: 11px;
    }
    #${WIDGET_ID} .vac-powered a {
      color: #2DD4BF;
      text-decoration: none;
    }
  `;

  // ── Core API ───────────────────────────────────────────────

  async function _api(path, opts = {}) {
    const url = `${_config.apiUrl}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (_config.apiKey) headers['X-API-Key'] = _config.apiKey;
    
    const res = await fetch(url, { ...opts, headers: { ...headers, ...opts.headers } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(body.detail?.message || body.detail || body.message || `API error ${res.status}`);
    }
    return res.json();
  }

  async function _getChallenge() {
    const challenge = await _api('/v1/sdk/challenge');
    _state.challenge = challenge;
    if (_config.onChallenge) _config.onChallenge(challenge);
    return challenge;
  }

  async function _startCamera() {
    try {
      _state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: true,
      });
      const video = document.querySelector(`#${WIDGET_ID} video`);
      if (video) {
        video.srcObject = _state.stream;
        video.play();
      }
    } catch (e) {
      throw new Error('Camera access denied. Please allow camera and microphone access.');
    }
  }

  function _stopCamera() {
    if (_state.stream) {
      _state.stream.getTracks().forEach(t => t.stop());
      _state.stream = null;
    }
  }

  async function _startRecording() {
    _state.videoChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';
    
    _state.mediaRecorder = new MediaRecorder(_state.stream, { mimeType });
    _state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) _state.videoChunks.push(e.data);
    };
    _state.mediaRecorder.start(200);
    _state.recording = true;
  }

  function _stopRecording() {
    return new Promise((resolve) => {
      if (!_state.mediaRecorder || _state.mediaRecorder.state === 'inactive') {
        resolve(null);
        return;
      }
      _state.mediaRecorder.onstop = () => {
        const blob = new Blob(_state.videoChunks, { type: 'video/webm' });
        _state.recording = false;
        resolve(blob);
      };
      _state.mediaRecorder.stop();
    });
  }

  async function _verify(videoBlob) {
    const reader = new FileReader();
    const b64 = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(videoBlob);
    });

    const body = {
      video_b64: b64,
    };
    if (_state.challenge?.challenge_phrase) {
      body.challenge_phrase = _state.challenge.challenge_phrase;
    }
    if (_state.challenge?.challenge_gesture) {
      body.challenge_gesture = _state.challenge.challenge_gesture;
    }

    return _api('/v1/sdk/verify', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // ── UI Rendering ───────────────────────────────────────────

  function _injectStyles() {
    if (document.getElementById('vac-verify-styles')) return;
    const style = document.createElement('style');
    style.id = 'vac-verify-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  function _createWidget() {
    if (document.getElementById(WIDGET_ID)) return;
    _injectStyles();

    const div = document.createElement('div');
    div.id = WIDGET_ID;
    div.innerHTML = `
      <div class="vac-modal">
        <div class="vac-header">
          <span class="vac-brand">${_config.branding?.company_name || 'VAC PROTOCOL'}</span>
          <button class="vac-close" onclick="VACVerify.close()">&times;</button>
        </div>
        <div class="vac-body" id="vac-verify-content"></div>
        <div class="vac-footer">
          <span class="vac-powered">Secured by <a href="https://vacprotocol.org" target="_blank">VAC Protocol</a> — 558 patent claims</span>
        </div>
      </div>
    `;
    document.body.appendChild(div);
  }

  function _renderStep(html) {
    const el = document.getElementById('vac-verify-content');
    if (el) el.innerHTML = html;
  }

  function _renderCamera() {
    const ch = _state.challenge || {};
    let challengeHtml = '';
    if (ch.challenge_phrase) {
      challengeHtml += `<div>Say clearly:</div><div class="vac-challenge-phrase">"${ch.challenge_phrase}"</div>`;
    }
    if (ch.challenge_gesture) {
      challengeHtml += `<div style="margin-top:8px">Hold up:</div><div class="vac-challenge-gesture">${ch.challenge_gesture}</div>`;
    }

    _renderStep(`
      <div class="vac-title">Verify your identity</div>
      <div class="vac-subtitle">Look at the camera and follow the instructions below.</div>
      <div class="vac-video-container">
        <video autoplay muted playsinline></video>
        ${challengeHtml ? `<div class="vac-challenge">${challengeHtml}</div>` : ''}
      </div>
      <button class="vac-btn vac-btn-primary" id="vac-record-btn" onclick="VACVerify._onRecord()">
        Start Recording
      </button>
    `);
  }

  function _renderRecording() {
    const btn = document.getElementById('vac-record-btn');
    if (btn) {
      btn.className = 'vac-btn vac-btn-recording';
      btn.textContent = 'Recording... Click to stop';
      btn.onclick = () => VACVerify._onStopRecord();
    }
  }

  function _renderVerifying() {
    _renderStep(`
      <div class="vac-status">
        <div style="font-size:32px;margin-bottom:12px">🔍</div>
        <div class="vac-title" style="font-size:16px">Verifying...</div>
        <div class="vac-subtitle">Checking liveness, deepfake detection, and voice match.</div>
      </div>
    `);
  }

  function _renderSuccess(result) {
    _renderStep(`
      <div class="vac-success">
        <div class="vac-success-icon">✓</div>
        <div class="vac-success-title">Verified</div>
        <div class="vac-success-score">Trust score: ${(result.trust_score * 100).toFixed(0)}%</div>
      </div>
    `);
  }

  function _renderError(msg) {
    _renderStep(`
      <div class="vac-status">
        <div style="font-size:32px;margin-bottom:12px">⚠</div>
        <div class="vac-title" style="font-size:16px;color:#EF4444">Verification Failed</div>
        <div class="vac-subtitle">${msg}</div>
        <button class="vac-btn vac-btn-primary" style="margin-top:16px" onclick="VACVerify._restart()">Try Again</button>
      </div>
    `);
  }

  // ── Flow Control ───────────────────────────────────────────

  async function _onRecord() {
    try {
      await _startRecording();
      _renderRecording();
      // Auto-stop after configured timeout (default 8s)
      setTimeout(() => {
        if (_state.recording) VACVerify._onStopRecord();
      }, (_state.challenge?.expires_in_seconds || 8) * 1000);
    } catch (e) {
      _renderError(e.message);
    }
  }

  async function _onStopRecord() {
    try {
      const blob = await _stopRecording();
      _stopCamera();
      _renderVerifying();

      const result = await _verify(blob);

      if (result.verified) {
        _state.sessionToken = result.session_token;
        _renderSuccess(result);
        if (_config.onVerified) _config.onVerified(result);
        if (_config.closeOnVerified) {
          setTimeout(() => VACVerify.close(), 2000);
        }
      } else {
        const msg = `Trust score ${(result.trust_score * 100).toFixed(0)}% below threshold ${(result.trust_threshold * 100).toFixed(0)}%.`;
        _renderError(msg);
        if (_config.onError) _config.onError({ type: 'verification_failed', result });
      }
    } catch (e) {
      _renderError(e.message);
      if (_config.onError) _config.onError({ type: 'api_error', message: e.message });
    }
  }

  async function _restart() {
    try {
      _state.challenge = await _getChallenge();
      await _startCamera();
      _renderCamera();
    } catch (e) {
      _renderError(e.message);
    }
  }

  // ── Public API ─────────────────────────────────────────────

  return {
    VERSION,

    init(config = {}) {
      Object.assign(_config, config);
      _createWidget();
    },

    async open() {
      _createWidget();
      const widget = document.getElementById(WIDGET_ID);
      if (!widget) return;
      widget.classList.add('vac-open');
      _state.isOpen = true;

      try {
        _renderStep('<div class="vac-status">Loading challenge...</div>');
        _state.challenge = await _getChallenge();
        await _startCamera();
        _renderCamera();
      } catch (e) {
        _renderError(e.message);
        if (_config.onError) _config.onError({ type: 'init_error', message: e.message });
      }
    },

    close() {
      _stopCamera();
      const widget = document.getElementById(WIDGET_ID);
      if (widget) widget.classList.remove('vac-open');
      _state.isOpen = false;
      if (_config.onClose) _config.onClose();
    },

    getSessionToken() {
      return _state.sessionToken;
    },

    getConfig() {
      return { ..._config };
    },

    // Internal handlers (exposed for onclick)
    _onRecord: _onRecord,
    _onStopRecord: _onStopRecord,
    _restart: _restart,
  };
}));
