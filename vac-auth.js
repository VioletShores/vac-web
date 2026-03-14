/**
 * VAC Auth SDK — 3-Line Integration
 * ===================================
 * Verified Agent Chain · Identity by VAC Protocol
 * 
 * Usage:
 *   <script src="/vac-auth.js"></script>
 *   <div id="vac-auth"></div>
 *   <script>VAC.init({ app: 'regatta', onVerified: (user) => showApp(user) })</script>
 * 
 * L-174: Every copilot app MUST use VAC auth. No exceptions.
 * Patent claims: 1-15 (biometric binding), 16-38 (adaptive modality)
 * 
 * © 2026 Violet Shores Pty Ltd — vacprotocol.org
 */

(function(global) {
  'use strict';

  const API_BASE = 'https://vac-system-production.up.railway.app';
  const SESSION_KEY = 'vac_session';
  const USER_KEY = 'vac_user';
  const EMAIL_KEY = 'vac_email';  // persists email for quick re-auth

  // ============================================================
  // STATE
  // ============================================================
  let _config = {};
  let _state = 'idle'; // idle → email → otp → face → vouch → verified
  let _user = null;
  let _container = null;
  let _videoStream = null;

  // ============================================================
  // CORE API
  // ============================================================

  async function _api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = _getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, opts);
    const data = await res.json();
    if (!res.ok) {
      const msg = data.detail || data.error || `HTTP ${res.status}`;
      throw new Error(typeof msg === 'object' ? (msg.message || JSON.stringify(msg)) : msg);
    }
    return data;
  }

  function _getToken() {
    try { return localStorage.getItem(SESSION_KEY); } catch(e) { return null; }
  }

  function _setToken(token) {
    try { localStorage.setItem(SESSION_KEY, token); } catch(e) {}
  }

  function _clearToken() {
    try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(USER_KEY); } catch(e) {}
  }

  function _setUser(user) {
    _user = user;
    try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch(e) {}
    if (user && user.email) {
      try { localStorage.setItem(EMAIL_KEY, user.email); } catch(e) {}
    }
  }

  function _getStoredUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch(e) { return null; }
  }

  function _getStoredEmail() {
    try { return localStorage.getItem(EMAIL_KEY); } catch(e) { return null; }
  }

  // ============================================================
  // SESSION CHECK
  // ============================================================

  async function _checkSession() {
    const token = _getToken();
    if (!token) return null;

    try {
      const data = await _api('GET', '/v1/auth/session');
      if (data.valid) {
        const user = { email: data.email, name: data.name, auth_level: data.auth_level };
        // Fetch trust status
        try {
          const trust = await _api('GET', `/v1/auth/trust-status?email=${encodeURIComponent(data.email)}`);
          user.trust_level = trust.trust_level;
          user.is_verified = trust.is_verified;
          user.vouches_received = trust.vouches_received;
        } catch(e) {
          user.trust_level = 'unknown';
          user.is_verified = false;
        }
        _setUser(user);
        return user;
      }
    } catch (e) {
      _clearToken();
    }
    return null;
  }

  // ============================================================
  // RENDER — Auth Gate UI
  // ============================================================

  function _injectStyles() {
    if (document.getElementById('vac-auth-styles')) return;
    const style = document.createElement('style');
    style.id = 'vac-auth-styles';
    style.textContent = `
      @keyframes vacFadeIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
      @keyframes vacPulse { 0%,100% { opacity:1; } 50% { opacity:0.6; } }
      @keyframes vacSpin { to { transform:rotate(360deg); } }
      @keyframes vacShake { 0%,100% { transform:translateX(0); } 20%,60% { transform:translateX(-6px); } 40%,80% { transform:translateX(6px); } }

      .vac-gate {
        position:fixed; inset:0; z-index:99999;
        display:flex; align-items:center; justify-content:center;
        background:linear-gradient(145deg, #0a0c10 0%, #0d1117 50%, #0a0f14 100%);
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
        color:#e0e0e0;
      }
      .vac-gate * { box-sizing:border-box; margin:0; padding:0; }

      .vac-card {
        width:clamp(320px, 90vw, 420px);
        background:#111318;
        border:1px solid #1e2533;
        border-radius:16px;
        overflow:hidden;
        animation:vacFadeIn 0.4s ease;
      }

      .vac-header {
        padding:28px 28px 20px;
        text-align:center;
        border-bottom:1px solid #1a1f2b;
      }
      .vac-logo {
        width:48px; height:48px;
        margin:0 auto 14px;
        border-radius:10px;
      }
      .vac-title { font-size:18px; font-weight:600; color:#fff; margin-bottom:4px; }
      .vac-subtitle { font-size:13px; color:#6b7280; }

      .vac-body { padding:24px 28px 28px; }

      .vac-label {
        display:block;
        font-size:12px; font-weight:500;
        color:#9ca3af;
        margin-bottom:8px;
        text-transform:uppercase;
        letter-spacing:0.5px;
      }

      .vac-input {
        width:100%;
        padding:14px 16px;
        background:#0d0f17;
        border:1px solid #2a3040;
        border-radius:10px;
        color:#fff;
        font-size:16px;
        outline:none;
        transition:border-color 0.2s;
        -webkit-appearance:none;
      }
      .vac-input:focus { border-color:#22c55e; }
      .vac-input::placeholder { color:#4b5563; }
      .vac-input.vac-error { border-color:#ef4444; animation:vacShake 0.4s; }

      .vac-otp-row {
        display:flex; gap:8px; justify-content:center;
      }
      .vac-otp-digit {
        width:48px; height:56px;
        text-align:center;
        font-size:24px; font-weight:600;
        background:#0d0f17;
        border:1px solid #2a3040;
        border-radius:10px;
        color:#fff;
        outline:none;
        transition:border-color 0.2s;
        -webkit-appearance:none;
      }
      .vac-otp-digit:focus { border-color:#22c55e; }

      .vac-btn {
        width:100%;
        padding:14px;
        border:none;
        border-radius:10px;
        font-size:15px;
        font-weight:600;
        cursor:pointer;
        transition:all 0.2s;
        margin-top:16px;
        display:flex; align-items:center; justify-content:center; gap:8px;
      }
      .vac-btn-primary {
        background:#22c55e;
        color:#000;
      }
      .vac-btn-primary:hover:not(:disabled) { background:#16a34a; }
      .vac-btn-primary:disabled { opacity:0.5; cursor:not-allowed; }

      .vac-btn-secondary {
        background:transparent;
        color:#9ca3af;
        border:1px solid #2a3040;
        margin-top:10px;
      }
      .vac-btn-secondary:hover { color:#fff; border-color:#4b5563; }

      .vac-error-msg {
        color:#ef4444;
        font-size:13px;
        margin-top:10px;
        text-align:center;
        min-height:20px;
      }

      .vac-spinner {
        width:18px; height:18px;
        border:2px solid transparent;
        border-top-color:currentColor;
        border-radius:50%;
        animation:vacSpin 0.6s linear infinite;
        display:inline-block;
      }

      .vac-footer {
        padding:14px 28px;
        text-align:center;
        border-top:1px solid #1a1f2b;
      }
      .vac-footer-text {
        font-size:11px;
        color:#3b4252;
        font-family:'SF Mono',SFMono-Regular,Menlo,monospace;
      }
      .vac-footer-text a {
        color:#3b4252;
        text-decoration:none;
      }
      .vac-footer-text a:hover { color:#6b7280; }

      .vac-step-indicator {
        display:flex; align-items:center; justify-content:center;
        gap:8px; margin-bottom:20px;
      }
      .vac-step {
        width:8px; height:8px;
        border-radius:50%;
        background:#2a3040;
        transition:all 0.3s;
      }
      .vac-step.active { background:#22c55e; width:24px; border-radius:4px; }
      .vac-step.done { background:#16a34a; }

      .vac-face-preview {
        width:100%;
        aspect-ratio:4/3;
        border-radius:12px;
        background:#0d0f17;
        border:2px solid #2a3040;
        overflow:hidden;
        position:relative;
        margin-bottom:16px;
      }
      .vac-face-preview video {
        width:100%; height:100%;
        object-fit:cover;
        transform:scaleX(-1);
      }
      .vac-face-overlay {
        position:absolute; inset:0;
        display:flex; align-items:center; justify-content:center;
        pointer-events:none;
      }
      .vac-face-reticle {
        width:160px; height:200px;
        border:2px dashed #22c55e44;
        border-radius:80px;
      }
      .vac-face-hint {
        position:absolute; bottom:12px; left:0; right:0;
        text-align:center;
        font-size:13px; color:#9ca3af;
      }

      .vac-success-icon {
        width:64px; height:64px;
        margin:0 auto 16px;
        border-radius:50%;
        background:#22c55e22;
        display:flex; align-items:center; justify-content:center;
      }

      .vac-resend {
        font-size:13px;
        color:#6b7280;
        text-align:center;
        margin-top:14px;
      }
      .vac-resend a {
        color:#22c55e;
        cursor:pointer;
        text-decoration:none;
      }
      .vac-resend a:hover { text-decoration:underline; }

      .vac-hidden { display:none !important; }
    `;
    document.head.appendChild(style);
  }

  function _svgCheck() {
    return '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  }

  function _svgShield() {
    return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>';
  }

  // ============================================================
  // SCREENS
  // ============================================================

  function _renderGate() {
    const appNames = {
      regatta: 'Regatta Club Co-Pilot',
      derm: 'Zagarella Dermatology',
      default: 'Athena Co-Pilot',
    };
    const appName = appNames[_config.app] || _config.appName || appNames.default;

    _container.innerHTML = `
      <div class="vac-gate" id="vac-gate-overlay">
        <div class="vac-card">
          <div class="vac-header">
            <div style="margin:0 auto 14px; width:48px; height:48px; background:#22c55e15; border-radius:10px; display:flex; align-items:center; justify-content:center;">
              ${_svgShield()}
            </div>
            <div class="vac-title">${appName}</div>
            <div class="vac-subtitle">Verify your identity to continue</div>
          </div>
          <div class="vac-body" id="vac-screen"></div>
          <div class="vac-footer">
            <div class="vac-footer-text">
              Identity by <a href="https://vacprotocol.org" target="_blank">VAC Protocol</a> · Violet Shores
            </div>
          </div>
        </div>
      </div>
    `;
    _renderEmailScreen();
  }

  function _renderEmailScreen() {
    _state = 'email';
    const screen = document.getElementById('vac-screen');
    screen.innerHTML = `
      <div class="vac-step-indicator">
        <div class="vac-step active"></div>
        <div class="vac-step"></div>
        ${_config.requireFace !== false ? '<div class="vac-step"></div>' : ''}
      </div>
      <label class="vac-label">Email address</label>
      <input type="email" class="vac-input" id="vac-email" 
        placeholder="you@example.com" autocomplete="email" inputmode="email" autofocus />
      <button class="vac-btn vac-btn-primary" id="vac-send-btn">
        Send verification code
      </button>
      <div class="vac-error-msg" id="vac-error"></div>
    `;
    const input = document.getElementById('vac-email');
    const btn = document.getElementById('vac-send-btn');

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
    btn.addEventListener('click', () => _handleSendOTP());
  }

  async function _handleSendOTP() {
    const input = document.getElementById('vac-email');
    const btn = document.getElementById('vac-send-btn');
    const err = document.getElementById('vac-error');
    const email = input.value.trim().toLowerCase();

    if (!email || !email.includes('@')) {
      input.classList.add('vac-error');
      err.textContent = 'Please enter a valid email address.';
      setTimeout(() => input.classList.remove('vac-error'), 400);
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="vac-spinner"></span> Sending...';
    err.textContent = '';

    try {
      await _api('POST', '/v1/auth/login', { email, app_id: _config.app || 'default' });
      _config._email = email;
      _renderOTPScreen();
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'Send verification code';
    }
  }

  function _renderOTPScreen() {
    _state = 'otp';
    const screen = document.getElementById('vac-screen');
    screen.innerHTML = `
      <div class="vac-step-indicator">
        <div class="vac-step done"></div>
        <div class="vac-step active"></div>
        ${_config.requireFace !== false ? '<div class="vac-step"></div>' : ''}
      </div>
      <p style="font-size:14px; color:#9ca3af; text-align:center; margin-bottom:20px;">
        Code sent to <strong style="color:#fff;">${_config._email}</strong>
      </p>
      <div class="vac-otp-row" id="vac-otp-row">
        <input type="text" class="vac-otp-digit" maxlength="1" inputmode="numeric" pattern="[0-9]" data-idx="0" autofocus />
        <input type="text" class="vac-otp-digit" maxlength="1" inputmode="numeric" pattern="[0-9]" data-idx="1" />
        <input type="text" class="vac-otp-digit" maxlength="1" inputmode="numeric" pattern="[0-9]" data-idx="2" />
        <input type="text" class="vac-otp-digit" maxlength="1" inputmode="numeric" pattern="[0-9]" data-idx="3" />
        <input type="text" class="vac-otp-digit" maxlength="1" inputmode="numeric" pattern="[0-9]" data-idx="4" />
        <input type="text" class="vac-otp-digit" maxlength="1" inputmode="numeric" pattern="[0-9]" data-idx="5" />
      </div>
      <button class="vac-btn vac-btn-primary" id="vac-verify-btn" disabled>
        Verify code
      </button>
      <button class="vac-btn vac-btn-secondary" id="vac-back-btn">
        ← Different email
      </button>
      <div class="vac-error-msg" id="vac-error"></div>
      <div class="vac-resend" id="vac-resend">
        Didn't receive it? <a id="vac-resend-btn">Resend code</a>
      </div>
    `;

    _setupOTPInputs();
    document.getElementById('vac-back-btn').addEventListener('click', _renderEmailScreen);
    document.getElementById('vac-verify-btn').addEventListener('click', () => _handleVerifyOTP());
    document.getElementById('vac-resend-btn').addEventListener('click', async () => {
      try {
        await _api('POST', '/v1/auth/login', { email: _config._email, app_id: _config.app || 'default' });
        document.getElementById('vac-resend').innerHTML = '<span style="color:#22c55e;">New code sent!</span>';
      } catch(e) {
        document.getElementById('vac-resend').innerHTML = `<span style="color:#ef4444;">${e.message}</span>`;
      }
    });
  }

  function _setupOTPInputs() {
    const digits = document.querySelectorAll('.vac-otp-digit');
    const verifyBtn = document.getElementById('vac-verify-btn');

    function getCode() {
      return Array.from(digits).map(d => d.value).join('');
    }

    function checkComplete() {
      const code = getCode();
      verifyBtn.disabled = code.length < 6;
      if (code.length === 6) _handleVerifyOTP();
    }

    digits.forEach((digit, i) => {
      digit.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '');
        e.target.value = val ? val[0] : '';
        if (val && i < 5) digits[i + 1].focus();
        checkComplete();
      });

      digit.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !digit.value && i > 0) {
          digits[i - 1].focus();
          digits[i - 1].value = '';
        }
      });

      // Handle paste
      digit.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        for (let j = 0; j < Math.min(text.length, 6 - i); j++) {
          digits[i + j].value = text[j];
        }
        const nextIdx = Math.min(i + text.length, 5);
        digits[nextIdx].focus();
        checkComplete();
      });
    });

    setTimeout(() => digits[0].focus(), 100);
  }

  async function _handleVerifyOTP() {
    const digits = document.querySelectorAll('.vac-otp-digit');
    const code = Array.from(digits).map(d => d.value).join('');
    if (code.length < 6) return;

    const btn = document.getElementById('vac-verify-btn');
    const err = document.getElementById('vac-error');
    btn.disabled = true;
    btn.innerHTML = '<span class="vac-spinner"></span> Verifying...';
    err.textContent = '';

    try {
      const data = await _api('POST', '/v1/auth/verify', {
        email: _config._email,
        code: code,
        app_id: _config.app || 'default',
        name: _config._email.split('@')[0],
      });

      _setToken(data.session_token);
      _setUser({ email: data.email, name: data.name, auth_level: data.auth_level });

      if (_config.requireFace !== false) {
        _renderFaceScreen();
      } else {
        _renderVouchScreen();
      }
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'Verify code';
      digits.forEach(d => { d.value = ''; d.classList.add('vac-error'); });
      setTimeout(() => digits.forEach(d => d.classList.remove('vac-error')), 400);
      digits[0].focus();
    }
  }

  function _renderFaceScreen() {
    _state = 'face';
    const screen = document.getElementById('vac-screen');
    screen.innerHTML = `
      <div class="vac-step-indicator">
        <div class="vac-step done"></div>
        <div class="vac-step done"></div>
        <div class="vac-step active"></div>
      </div>
      <p style="font-size:14px; color:#9ca3af; text-align:center; margin-bottom:16px;">
        Quick face check to confirm it's you
      </p>
      <div class="vac-face-preview" id="vac-face-preview">
        <video id="vac-face-video" autoplay playsinline muted></video>
        <div class="vac-face-overlay">
          <div class="vac-face-reticle"></div>
        </div>
        <div class="vac-face-hint">Position your face in the oval</div>
      </div>
      <button class="vac-btn vac-btn-primary" id="vac-face-btn">
        Verify face
      </button>
      <button class="vac-btn vac-btn-secondary" id="vac-skip-face">
        Skip for now
      </button>
      <div class="vac-error-msg" id="vac-error"></div>
    `;

    _startCamera();
    document.getElementById('vac-face-btn').addEventListener('click', () => _handleFaceVerify());
    document.getElementById('vac-skip-face').addEventListener('click', () => _renderVouchScreen());
  }

  async function _startCamera() {
    const video = document.getElementById('vac-face-video');
    try {
      _videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      video.srcObject = _videoStream;
    } catch (e) {
      document.getElementById('vac-error').textContent = 'Camera access required for face verification.';
    }
  }

  function _stopCamera() {
    if (_videoStream) {
      _videoStream.getTracks().forEach(t => t.stop());
      _videoStream = null;
    }
  }

  async function _handleFaceVerify() {
    const btn = document.getElementById('vac-face-btn');
    const err = document.getElementById('vac-error');
    btn.disabled = true;
    btn.innerHTML = '<span class="vac-spinner"></span> Verifying...';

    try {
      // Capture frame
      const video = document.getElementById('vac-face-video');
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const frame = canvas.toDataURL('image/jpeg', 0.7);

      const data = await _api('POST', '/v1/auth/face-verify', {
        session_token: _getToken(),
        face_frame: frame,
      });

      // Upgrade session
      _setToken(data.session_token);
      _setUser({ email: data.email, name: data.name, auth_level: data.auth_level });
      _stopCamera();
      _renderVouchScreen();
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'Verify face';
    }
  }

  // ============================================================
  // VOUCH SCREEN — The trust graph growth mechanism
  // ============================================================

  async function _renderVouchScreen() {
    _state = 'vouch';
    _stopCamera();
    const screen = document.getElementById('vac-screen');
    const user = _getStoredUser();
    const email = (user && user.email) || _config._email || '';

    // Check trust status
    let trust = { trust_level: 'unverified', vouches_received: 0, vouches_pending: 0 };
    try {
      trust = await _api('GET', `/v1/auth/trust-status?email=${encodeURIComponent(email)}`);
    } catch(e) {}

    // If already verified (1+ vouches), skip vouch screen entirely
    if (trust.is_verified) {
      const u = _getStoredUser() || {};
      u.trust_level = trust.trust_level;
      u.is_verified = true;
      u.vouches_received = trust.vouches_received;
      _setUser(u);
      _handleAuthComplete();
      return;
    }

    const hasPending = trust.vouches_pending > 0;

    screen.innerHTML = `
      <div style="text-align:center;margin-bottom:20px;">
        <div style="width:48px;height:48px;margin:0 auto 12px;border-radius:50%;background:${hasPending ? '#fbbf2422' : '#22c55e15'};display:flex;align-items:center;justify-content:center;">
          ${hasPending
            ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
            : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>'}
        </div>
        <div style="font-size:16px;font-weight:600;color:#fff;margin-bottom:4px;">
          ${hasPending ? 'Waiting for vouch' : 'One more step'}
        </div>
        <div style="font-size:13px;color:#6b7280;line-height:1.5;">
          ${hasPending
            ? 'Your vouch request has been sent. Once confirmed, your identity is fully verified.'
            : 'Ask someone you trust to verify your identity. This builds the trust chain that keeps everyone safe.'}
        </div>
      </div>

      ${hasPending ? `
        <div style="background:#fbbf2411;border:1px solid #fbbf2433;border-radius:10px;padding:14px;margin-bottom:16px;text-align:center;">
          <div style="font-size:12px;color:#fbbf24;font-weight:600;margin-bottom:4px;">VOUCH PENDING</div>
          <div style="font-size:13px;color:#9ca3af;">We'll notify you when it's confirmed</div>
        </div>
      ` : `
        <label class="vac-label">Who can vouch for you?</label>
        <input type="text" class="vac-input" id="vac-voucher-name" placeholder="Their name" style="margin-bottom:8px;" />
        <input type="email" class="vac-input" id="vac-voucher-email" placeholder="Their email" inputmode="email" />
        <input type="text" class="vac-input" id="vac-voucher-msg" placeholder="Personal message (optional)" style="margin-top:8px;font-size:14px;" />
        <button class="vac-btn vac-btn-primary" id="vac-vouch-btn">
          Send vouch request
        </button>
      `}

      <button class="vac-btn vac-btn-secondary" id="vac-skip-vouch">
        ${hasPending ? 'Continue to app' : 'Skip for now'}
      </button>
      <div class="vac-error-msg" id="vac-error"></div>

      <div style="margin-top:16px;padding-top:14px;border-top:1px solid #1a1f2b;">
        <div style="font-size:11px;color:#3b4252;text-align:center;line-height:1.5;">
          VAC Protocol uses a chain of trust — each vouch creates a cryptographic<br>
          link confirming you are who you say you are.
        </div>
      </div>
    `;

    if (!hasPending) {
      document.getElementById('vac-vouch-btn').addEventListener('click', () => _handleRequestVouch());
    }
    document.getElementById('vac-skip-vouch').addEventListener('click', () => {
      // Let them in but mark as unverified
      const u = _getStoredUser() || {};
      u.trust_level = hasPending ? 'pending' : 'unverified';
      u.is_verified = false;
      _setUser(u);
      _handleAuthComplete();
    });
  }

  async function _handleRequestVouch() {
    const nameInput = document.getElementById('vac-voucher-name');
    const emailInput = document.getElementById('vac-voucher-email');
    const msgInput = document.getElementById('vac-voucher-msg');
    const btn = document.getElementById('vac-vouch-btn');
    const err = document.getElementById('vac-error');

    const name = nameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();
    const msg = msgInput.value.trim();

    if (!name) { nameInput.classList.add('vac-error'); setTimeout(() => nameInput.classList.remove('vac-error'), 400); return; }
    if (!email || !email.includes('@')) { emailInput.classList.add('vac-error'); setTimeout(() => emailInput.classList.remove('vac-error'), 400); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="vac-spinner"></span> Sending...';
    err.textContent = '';

    try {
      const data = await _api('POST', '/v1/auth/request-vouch', {
        voucher_name: name,
        voucher_email: email,
        message: msg,
        app_id: _config.app || 'default',
      });

      // Re-render with pending state
      _renderVouchScreen();
    } catch(e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'Send vouch request';
    }
  }

  // ============================================================
  // QUICK RE-AUTH — Returning users with expired sessions
  // ============================================================

  function _renderQuickReauthScreen(email) {
    _state = 'quick_reauth';
    const screen = document.getElementById('vac-screen');
    screen.innerHTML = `
      <div class="vac-step-indicator">
        <div class="vac-step active"></div>
      </div>
      <p style="font-size:14px;color:#9ca3af;text-align:center;margin-bottom:8px;">
        Welcome back, <strong style="color:#fff;">${email}</strong>
      </p>
      <p style="font-size:13px;color:#6b7280;text-align:center;margin-bottom:16px;">
        Quick check — hold up the number of fingers shown
      </p>
      <div class="vac-face-preview" id="vac-face-preview">
        <video id="vac-face-video" autoplay playsinline muted></video>
        <div class="vac-face-overlay">
          <div class="vac-face-reticle"></div>
        </div>
        <div class="vac-face-hint" id="vac-finger-hint">Loading challenge...</div>
      </div>
      <button class="vac-btn vac-btn-primary" id="vac-quick-btn" disabled>
        Verify
      </button>
      <button class="vac-btn vac-btn-secondary" id="vac-quick-full">
        Use email instead
      </button>
      <div class="vac-error-msg" id="vac-error"></div>
    `;

    _startCamera();
    document.getElementById('vac-quick-full').addEventListener('click', () => _renderEmailScreen());

    // Fetch challenge
    _api('POST', '/v1/auth/quick-challenge', { email: email }).then(data => {
      _config._quickChallenge = data;
      document.getElementById('vac-finger-hint').textContent = data.instruction;
      document.getElementById('vac-finger-hint').style.color = '#22c55e';
      const btn = document.getElementById('vac-quick-btn');
      btn.disabled = false;
      btn.addEventListener('click', () => _handleQuickVerify(data, email));
    }).catch(e => {
      document.getElementById('vac-error').textContent = e.message;
      document.getElementById('vac-finger-hint').textContent = 'Challenge failed — use email instead';
    });
  }

  async function _handleQuickVerify(challenge, email) {
    const btn = document.getElementById('vac-quick-btn');
    const err = document.getElementById('vac-error');
    btn.disabled = true;
    btn.innerHTML = '<span class="vac-spinner"></span> Verifying...';

    try {
      // Phase 1: trust the user to hold up correct fingers
      // Phase 2: Gemini counts fingers from camera frame
      const data = await _api('POST', '/v1/auth/quick-verify', {
        challenge_id: challenge.challenge_id,
        detected_fingers: challenge.num_fingers,  // Phase 1: auto-pass. Phase 2: Gemini detection
      });

      _setToken(data.session_token);
      _setUser({ email: data.email, name: data.email.split('@')[0], auth_level: data.auth_level });
      _stopCamera();
      _handleAuthComplete();
    } catch(e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'Verify';
    }
  }

  function _handleAuthComplete() {
    _state = 'verified';
    _stopCamera();

    const user = _getStoredUser();
    const overlay = document.getElementById('vac-gate-overlay');

    // Brief success flash
    const screen = document.getElementById('vac-screen');
    screen.innerHTML = `
      <div style="text-align:center; padding:20px 0;">
        <div class="vac-success-icon">${_svgCheck()}</div>
        <div style="font-size:16px; font-weight:600; color:#fff; margin-bottom:4px;">Verified</div>
        <div style="font-size:13px; color:#6b7280;">${user?.email || ''}</div>
      </div>
    `;

    setTimeout(() => {
      // Fade out
      overlay.style.transition = 'opacity 0.3s';
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.remove();
        if (_config.onVerified) _config.onVerified(user);
      }, 300);
    }, 800);
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  const VAC = {
    /**
     * Initialize VAC Auth gate.
     * @param {Object} config
     * @param {string} config.app - App identifier ('regatta', 'derm', etc.)
     * @param {string} [config.appName] - Display name override
     * @param {Function} config.onVerified - Called with user object when auth completes
     * @param {boolean} [config.requireFace=true] - Require face verification step
     * @param {string} [config.container='vac-auth'] - Container element ID
     */
    init: function(config) {
      _config = config || {};
      _injectStyles();

      _container = document.getElementById(config.container || 'vac-auth');
      if (!_container) {
        _container = document.createElement('div');
        _container.id = 'vac-auth';
        document.body.appendChild(_container);
      }

      // Check for existing valid session
      _checkSession().then(user => {
        if (user) {
          // Session valid — check if they need to vouch still
          if (!user.is_verified && _config.requireVouch !== false) {
            _renderGate();
            _renderVouchScreen();
          } else {
            _state = 'verified';
            if (_config.onVerified) _config.onVerified(user);
          }
        } else {
          // No valid session — check if returning user (email stored)
          const storedEmail = _getStoredEmail();
          if (storedEmail) {
            // Returning user with expired session → quick re-auth
            _renderGate();
            _renderQuickReauthScreen(storedEmail);
          } else {
            // New user → full flow
            _renderGate();
          }
        }
      });
    },

    /** Get current user (null if not authenticated) */
    getUser: function() {
      return _user || _getStoredUser();
    },

    /** Get current session token (null if not authenticated) */
    getToken: function() {
      return _getToken();
    },

    /** Sign out — clear session and reload auth gate */
    logout: function() {
      _clearToken();
      try { localStorage.removeItem(EMAIL_KEY); } catch(e) {}
      _user = null;
      _state = 'idle';
      _stopCamera();
      if (_container) _renderGate();
    },

    /** Check if session is currently valid */
    isAuthenticated: async function() {
      const user = await _checkSession();
      return !!user;
    },

    /** Check if user is verified (has at least 1 vouch) */
    isVerified: function() {
      const user = _user || _getStoredUser();
      return user ? !!user.is_verified : false;
    },

    /** Get trust level: unverified, pending, verified, trusted */
    getTrustLevel: function() {
      const user = _user || _getStoredUser();
      return user ? (user.trust_level || 'unknown') : 'none';
    },

    /** Get auth headers for API calls */
    headers: function() {
      const token = _getToken();
      return token ? { 'Authorization': `Bearer ${token}` } : {};
    },
  };

  // Export
  global.VAC = VAC;

})(typeof window !== 'undefined' ? window : this);
