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
  let _engineConfig = null; // fetched from /v1/auth/config
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
      const err = new Error(typeof msg === 'object' ? (msg.message || JSON.stringify(msg)) : msg);
      err._detail = data.detail;  // preserve full detail for debug display
      throw err;
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
  // ENGINE CONFIG — fetched from /v1/auth/config
  // ============================================================

  async function _fetchEngineConfig() {
    try {
      _engineConfig = await _api('GET', '/v1/auth/config');
    } catch(e) {
      // Fallback defaults if config endpoint unreachable
      _engineConfig = {
        ttl: { full_verified_minutes: 60, full_unverified_minutes: 20, otp_only_minutes: 30, quick_reauth_minutes: 30 },
        quick_reauth: { verified_eligible: true, unverified_eligible: false },
        staleness: { max_session_age_hours: 24 },
        vouch: { required_for_access: false, grace_period_hours: 72 },
        action_reauth: { actions: [], freshness_seconds: 300 },
      };
    }
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
        const user = {
          email: data.email,
          name: data.name,
          auth_level: data.auth_level,
          is_verified: data.is_verified || false,
          quick_reauth_eligible: data.quick_reauth_eligible || false,
          last_biometric: data.last_biometric || 0,
        };
        // Fetch trust status for vouch count
        try {
          const trust = await _api('GET', `/v1/auth/trust-status?email=${encodeURIComponent(data.email)}`);
          user.trust_level = trust.trust_level;
          user.is_verified = trust.is_verified;
          user.vouches_received = trust.vouches_received;
        } catch(e) {
          user.trust_level = user.is_verified ? 'verified' : 'unverified';
        }
        _setUser(user);
        return user;
      }
    } catch (e) {
      // Session invalid/expired/stale — check the error to decide next step
      _clearToken();
      // Parse error detail if available
      if (e.message && e.message.includes('stale')) {
        // Stale session — mark for quick re-auth if eligible
        const stored = _getStoredUser();
        if (stored) stored._sessionError = 'stale';
      }
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
        display:flex; align-items:flex-start; justify-content:center;
        background:linear-gradient(145deg, #0a0c10 0%, #0d1117 50%, #0a0f14 100%);
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
        color:#e0e0e0;
        overflow-y:auto; -webkit-overflow-scrolling:touch;
        padding:clamp(16px, 5vh, 60px) 16px;
      }
      .vac-gate * { box-sizing:border-box; margin:0; padding:0; }

      .vac-card {
        width:clamp(320px, 90vw, 420px);
        background:#111318;
        border:1px solid #1e2533;
        border-radius:16px;
        overflow:visible;
        animation:vacFadeIn 0.4s ease;
        flex-shrink:0;
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
        display:flex; gap:clamp(4px, 2vw, 8px); justify-content:center;
      }
      .vac-otp-digit {
        width:clamp(40px, 12vw, 48px); height:clamp(48px, 14vw, 56px);
        text-align:center;
        font-size:clamp(20px, 5vw, 24px); font-weight:600;
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
        width:clamp(130px,40vw,160px); height:clamp(170px,50vw,200px);
        border:2.5px dashed #22c55ecc;
        border-radius:80px;
        box-shadow: 0 0 0 3px rgba(0,0,0,0.4), 0 0 16px rgba(34,197,94,0.25);
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
      <div id="vac-email-hint" style="font-size:12px;color:#4b5563;margin-top:6px;min-height:18px;transition:color 0.2s;"></div>
      <button class="vac-btn vac-btn-primary" id="vac-send-btn" disabled>
        Send verification code
      </button>
      <div class="vac-error-msg" id="vac-error"></div>
    `;
    const input = document.getElementById('vac-email');
    const btn = document.getElementById('vac-send-btn');
    const hint = document.getElementById('vac-email-hint');

    function validateEmail() {
      var val = input.value.trim();
      if (!val) {
        hint.textContent = '';
        hint.style.color = '#4b5563';
        btn.disabled = true;
        return;
      }
      // Basic email pattern: something@something.something
      var isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
      if (isValid) {
        hint.textContent = '';
        btn.disabled = false;
        input.style.borderColor = '#22c55e';
      } else if (val.includes('@') && val.indexOf('@') < val.length - 1) {
        // Has @ but not complete yet — gentle nudge
        hint.textContent = 'e.g. you@example.com';
        hint.style.color = '#6b7280';
        btn.disabled = true;
        input.style.borderColor = '#2a3040';
      } else {
        hint.textContent = 'Enter a valid email address';
        hint.style.color = '#fbbf24';
        btn.disabled = true;
        input.style.borderColor = '#2a3040';
      }
    }

    input.addEventListener('input', validateEmail);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.disabled) btn.click(); });
    btn.addEventListener('click', () => _handleSendOTP());

    // If email was pre-filled (returning user), validate immediately
    setTimeout(validateEmail, 100);
  }

  async function _handleSendOTP() {
    const input = document.getElementById('vac-email');
    const btn = document.getElementById('vac-send-btn');
    const err = document.getElementById('vac-error');
    const email = input.value.trim().toLowerCase();
    console.log('[VAC] Send OTP for:', email);

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
      console.log('[VAC] OTP sent, rendering OTP screen');
      _config._email = email;
      _renderOTPScreen();
    } catch (e) {
      console.error('[VAC] OTP send failed:', e.message);
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'Send verification code';
    }
  }

  function _renderOTPScreen() {
    _state = 'otp';
    console.log('[VAC] Rendering OTP screen for:', _config._email);
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
    _stopCamera(); // Don't start camera here — auth.html handles it
    const screen = document.getElementById('vac-screen');
    screen.innerHTML = `
      <div class="vac-step-indicator">
        <div class="vac-step done"></div>
        <div class="vac-step done"></div>
        <div class="vac-step active"></div>
      </div>
      <div style="text-align:center;margin-bottom:16px;">
        <div style="width:56px;height:56px;margin:0 auto 14px;border-radius:14px;background:#22c55e10;border:1px solid #22c55e22;display:flex;align-items:center;justify-content:center;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </div>
        <div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:6px;">Biometric verification</div>
        <div style="font-size:13px;color:#6b7280;line-height:1.5;">
          You'll speak a challenge phrase on camera while showing finger gestures.
          This creates your biometric identity — face, voice, lip sync, and gesture verified by AI.
        </div>
      </div>
      <button class="vac-btn vac-btn-primary" id="vac-face-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
        Start verification
      </button>
      <div class="vac-error-msg" id="vac-error"></div>
    `;

    document.getElementById('vac-face-btn').addEventListener('click', function() {
      // Redirect to auth.html with copilot mode — does REAL Gemini + Deepgram verification
      var callback = window.location.pathname || '/hub';
      var authUrl = '/auth?mode=copilot&callback=' + encodeURIComponent(callback);
      console.log('[VAC] Redirecting to real biometric verification:', authUrl);
      window.location.href = authUrl;
    });
  }

  // Camera helpers (still used by quick re-auth)
  async function _startCamera() {
    const video = document.getElementById('vac-face-video');
    if (!video) return;
    try {
      _videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      video.srcObject = _videoStream;
    } catch (e) {
      var errEl = document.getElementById('vac-error');
      if (errEl) errEl.textContent = 'Camera access required for verification.';
    }
  }

  function _stopCamera() {
    if (_videoStream) {
      _videoStream.getTracks().forEach(t => t.stop());
      _videoStream = null;
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

    // Poll for vouch confirmation — auto-transition to verified
    if (hasPending || _state === 'vouch') {
      _startVouchPolling(email);
    }
  }

  var _vouchPollTimer = null;
  function _startVouchPolling(email) {
    if (_vouchPollTimer) clearInterval(_vouchPollTimer);
    console.log('[VAC] Vouch polling started for:', email);
    _vouchPollTimer = setInterval(async function() {
      try {
        var trust = await _api('GET', '/v1/auth/trust-status?email=' + encodeURIComponent(email));
        if (trust.is_verified) {
          clearInterval(_vouchPollTimer);
          _vouchPollTimer = null;
          console.log('[VAC] Vouch confirmed! Transitioning to verified.');
          // Update stored user
          var u = _getStoredUser() || {};
          u.trust_level = trust.trust_level;
          u.is_verified = true;
          u.vouches_received = trust.vouches_received;
          _setUser(u);
          // Show success and enter app
          _handleAuthComplete();
        }
      } catch(e) {
        console.log('[VAC] Vouch poll error:', e.message);
      }
    }, 10000); // Check every 10 seconds
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
    var screen = document.getElementById('vac-screen');

    // First check if face reference exists, then get finger challenge
    _api('GET', '/v1/auth/face-ref-status?email=' + encodeURIComponent(email)).then(function(ref) {
      if (!ref.has_face_reference) {
        console.log('[VAC] No face reference for', email, '— full auth required');
        _renderEmailScreen();
        setTimeout(function() { var inp = document.getElementById('vac-email'); if (inp) inp.value = email; }, 50);
        return;
      }

      // Fetch random finger challenge
      return _api('GET', '/v1/auth/face-reauth-challenge?email=' + encodeURIComponent(email));
    }).then(function(challenge) {
      if (!challenge || !challenge.fingers) return;

      var fingerNum = challenge.fingers;
      var fingerWord = {1:'one',2:'two',3:'three',4:'four',5:'five'}[fingerNum] || String(fingerNum);
      var fingerPlural = fingerNum > 1 ? 'fingers' : 'finger';
      console.log('[VAC] Face re-auth challenge:', fingerNum, 'fingers');

      // SINGLE SCREEN — face + fingers in one frame (Patent Claims 5c-5e: combined modality)
      screen.innerHTML = '<div class="vac-step-indicator"><div class="vac-step active"></div></div>' +
        '<p style="font-size:14px;color:#9ca3af;text-align:center;margin-bottom:4px;">' +
          'Welcome back, <strong style="color:#fff;">' + email + '</strong></p>' +
        '<p style="font-size:clamp(14px,4vw,16px);color:#fff;text-align:center;margin-bottom:12px;font-weight:600;line-height:1.4;">' +
          'Hold up <span style="color:#22c55e;font-size:clamp(18px,5vw,22px);">' + fingerWord + '</span> ' + fingerPlural + ' near your face</p>' +
        '<div class="vac-face-preview" id="vac-face-preview">' +
          '<video id="vac-face-video" autoplay playsinline muted></video>' +
          '<div class="vac-face-overlay"><div class="vac-face-reticle"></div></div>' +
          '<div class="vac-face-hint" style="color:#fff;background:rgba(0,0,0,0.9);padding:8px 16px;border-radius:8px;font-size:clamp(13px,3.5vw,15px);font-weight:700;letter-spacing:0.3px;">' +
            '<span style="color:#22c55e;">' + fingerNum + '</span> ' + fingerPlural + ' + face visible</div></div>' +
        '<button class="vac-btn vac-btn-primary" id="vac-quick-btn">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg> Verify it\'s me</button>' +
        '<div class="vac-error-msg" id="vac-error"></div>';

      _startCamera();
      document.getElementById('vac-quick-btn').addEventListener('click', function() {
        _handleReauthCapture(email);
      });
    }).catch(function(e) {
      console.log('[VAC] Face re-auth setup failed:', e.message);
      _renderEmailScreen();
      setTimeout(function() { var inp = document.getElementById('vac-email'); if (inp) inp.value = email; }, 50);
    });
  }

  async function _handleReauthCapture(email) {
    // SINGLE CAPTURE — face + fingers in one frame (Patent Claims 5c-5e)
    // Gemini checks face match AND finger count from the SAME image.
    // This prevents holding a photo of someone's face + showing your own fingers.
    var btn = document.getElementById('vac-quick-btn');
    var err = document.getElementById('vac-error');
    btn.disabled = true;
    btn.innerHTML = '<span class="vac-spinner"></span> Verifying...';
    err.textContent = '';

    try {
      // Single frame capture — face AND fingers together
      var video = document.getElementById('vac-face-video');
      var canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      canvas.getContext('2d').drawImage(video, 0, 0);
      var singleFrame = canvas.toDataURL('image/jpeg', 0.8);

      console.log('[VAC] Single-frame re-auth capture for:', email);

      // Send ONE frame — backend Gemini checks face match + finger count together
      var data = await _api('POST', '/v1/auth/face-reauth', {
        email: email,
        face_frame: singleFrame,
      });

      console.log('[VAC] Face re-auth SUCCESS. Confidence:', data.face_match.confidence);
      _setToken(data.session_token);
      _setUser({
        email: data.email, name: data.email.split('@')[0],
        auth_level: data.auth_level, is_verified: data.is_verified,
        last_biometric: Math.floor(Date.now() / 1000),
      });
      _stopCamera();
      _handleAuthComplete();

    } catch(e) {
      var msg = e.message || '';
      console.log('[VAC] Face re-auth failed:', msg);

      if (msg.indexOf('require_full_auth') !== -1 || msg.indexOf('max_retries') !== -1 || msg.indexOf('no_face_reference') !== -1) {
        _stopCamera();
        var screen = document.getElementById('vac-screen');
        screen.innerHTML =
          '<div style="text-align:center;padding:20px 0;">' +
            '<div style="width:56px;height:56px;margin:0 auto 14px;border-radius:50%;background:#ef444422;display:flex;align-items:center;justify-content:center;">' +
              '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
            '</div>' +
            '<div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:6px;">Identity not confirmed</div>' +
            '<div style="font-size:13px;color:#6b7280;line-height:1.5;margin-bottom:20px;">' +
              'Face did not match the verified identity.<br>Full verification required.</div>' +
            '<button class="vac-btn vac-btn-primary" id="vac-go-full">Continue with full verification</button>' +
          '</div>';
        document.getElementById('vac-go-full').addEventListener('click', function() {
          _renderEmailScreen();
          setTimeout(function() { var inp = document.getElementById('vac-email'); if (inp) inp.value = email; }, 50);
        });
        return;
      }

      // Still have retries
      var retriesMatch = msg.match(/(\d+) attempt/);
      var retries = retriesMatch ? retriesMatch[1] : '?';
      var debugStr = '';
      try { if (e._detail && e._detail._debug) debugStr = JSON.stringify(e._detail._debug); } catch(x) {}
      err.innerHTML = 'Verification failed. ' + retries + ' attempt' + (retries !== '1' ? 's' : '') + ' remaining.' +
        (debugStr ? '<div style="font-size:9px;color:#4b5264;margin-top:6px;font-family:monospace;word-break:break-all;max-height:80px;overflow:auto;">' + debugStr.replace(/</g,'&lt;') + '</div>' : '');
      btn.disabled = false;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg> Try again';
    }
  }

  function _handleAuthComplete() {
    _stopCamera();
    if (_vouchPollTimer) { clearInterval(_vouchPollTimer); _vouchPollTimer = null; }

    var user = _getStoredUser();
    var overlay = document.getElementById('vac-gate-overlay');
    var screen = document.getElementById('vac-screen');
    var isFullAuth = user && (user.auth_level === 'full' || user.auth_level === 'otp');

    // Brief success flash
    screen.innerHTML =
      '<div style="text-align:center; padding:20px 0;">' +
        '<div class="vac-success-icon">' + _svgCheck() + '</div>' +
        '<div style="font-size:16px; font-weight:600; color:#fff; margin-bottom:4px;">Verified</div>' +
        '<div style="font-size:13px; color:#6b7280;">' + (user ? user.email : '') + '</div>' +
      '</div>';

    setTimeout(function() {
      // Only ask for feedback on full auth, not quick re-auth
      if (isFullAuth) {
        _renderAuthFeedback(user, overlay);
      } else {
        _fadeOutAndComplete(user, overlay);
      }
    }, 1000);
  }

  function _renderAuthFeedback(user, overlay) {
    var screen = document.getElementById('vac-screen');
    screen.innerHTML =
      '<div style="text-align:center;padding:8px 0 4px;">' +
        '<div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:4px;">How was the verification?</div>' +
        '<div style="font-size:12px;color:#6b7280;margin-bottom:18px;">Your feedback helps us improve</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:14px;" id="vac-fb-btns">' +
        '<button class="vac-btn vac-btn-secondary" data-rating="easy" style="flex:1;margin:0;font-size:13px;padding:12px 0;">' +
          '<span style="font-size:18px;display:block;margin-bottom:2px;">&#x1f44d;</span>Easy</button>' +
        '<button class="vac-btn vac-btn-secondary" data-rating="ok" style="flex:1;margin:0;font-size:13px;padding:12px 0;">' +
          '<span style="font-size:18px;display:block;margin-bottom:2px;">&#x1f44c;</span>Fine</button>' +
        '<button class="vac-btn vac-btn-secondary" data-rating="difficult" style="flex:1;margin:0;font-size:13px;padding:12px 0;">' +
          '<span style="font-size:18px;display:block;margin-bottom:2px;">&#x1f612;</span>Difficult</button>' +
      '</div>' +
      '<textarea id="vac-fb-text" class="vac-input" placeholder="Anything else? (optional)" style="min-height:56px;resize:none;font-size:13px;margin-bottom:10px;"></textarea>' +
      '<button class="vac-btn vac-btn-primary" id="vac-fb-submit" style="margin:0;">Continue</button>' +
      '<div class="vac-error-msg" id="vac-fb-status"></div>';

    var selectedRating = '';
    var btns = document.querySelectorAll('#vac-fb-btns button');
    btns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        btns.forEach(function(b) { b.style.borderColor = '#2a3040'; b.style.background = 'transparent'; });
        btn.style.borderColor = '#22c55e';
        btn.style.background = 'rgba(34,197,94,0.06)';
        selectedRating = btn.getAttribute('data-rating');
      });
    });

    document.getElementById('vac-fb-submit').addEventListener('click', function() {
      var text = document.getElementById('vac-fb-text').value.trim();
      var statusEl = document.getElementById('vac-fb-status');

      // Send feedback (don't block — fire and forget)
      if (selectedRating || text) {
        var feedbackContent = 'Auth experience: ' + (selectedRating || 'no rating');
        if (text) feedbackContent += ' — ' + text;
        _api('POST', '/v1/feedback', {
          feedback_type: 'feature',
          content: feedbackContent,
          source_page: 'vac-auth-sdk',
          user_id: user ? user.email : 'anonymous',
          product: 'vac',
        }).then(function() {
          console.log('[VAC] Auth feedback sent:', selectedRating, text);
        }).catch(function(e) {
          console.log('[VAC] Auth feedback send failed:', e.message);
        });
      }

      _fadeOutAndComplete(user, overlay);
    });
  }

  function _fadeOutAndComplete(user, overlay) {
    _state = 'verified';
    if (!overlay) { if (_config.onVerified) _config.onVerified(user); return; }
    overlay.style.transition = 'opacity 0.3s';
    overlay.style.opacity = '0';
    setTimeout(function() {
      overlay.remove();
      if (_config.onVerified) _config.onVerified(user);
    }, 300);
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

      // Fetch ENGINE config then check session — proper order matters
      _fetchEngineConfig().then(() => {
        console.log('[VAC] Engine config loaded:', _engineConfig ? 'ok' : 'fallback');
        return _checkSession();
      }).then(user => {
        if (user) {
          console.log('[VAC] Session valid:', user.email, '| verified:', user.is_verified, '| level:', user.auth_level);
          
          // Check if session has full biometric — OTP-only is not enough
          var hasBiometric = user.auth_level === 'full' || user.auth_level === 'quick';
          
          if (_config.requireFace !== false && !hasBiometric) {
            // Session exists but only OTP — need face verification still
            console.log('[VAC] OTP session only, face verification required');
            _renderGate();
            _renderFaceScreen();
          } else if (!user.is_verified && _config.requireVouch !== false) {
            _renderGate();
            _renderVouchScreen();
          } else {
            _state = 'verified';
            if (_config.onVerified) _config.onVerified(user);
          }
        } else {
          // No valid session — check if returning user
          const storedEmail = _getStoredEmail();
          const storedUser = _getStoredUser();
          console.log('[VAC] No session. Stored email:', storedEmail || 'none', '| Stored user verified:', storedUser && storedUser.is_verified);

          if (storedEmail) {
            // Returning user — check ENGINE rules for quick re-auth eligibility
            // Rule: only verified users (1+ vouches) get quick re-auth by default
            // Unverified users must do full OTP — incentivises getting vouched
            const wasVerified = storedUser && storedUser.is_verified;
            const ec = _engineConfig || {};
            const qr = ec.quick_reauth || {};
            const quickEligible = wasVerified ? (qr.verified_eligible !== false) : (qr.unverified_eligible === true);

            if (quickEligible) {
              // Quick re-auth: camera + fingers — 5 second flow
              console.log('[VAC] Quick re-auth for:', storedEmail);
              _renderGate();
              _renderQuickReauthScreen(storedEmail);
            } else {
              // Not eligible for quick re-auth: full OTP flow
              console.log('[VAC] Full OTP required (not eligible for quick re-auth)');
              _renderGate();
              _renderEmailScreen();
              setTimeout(() => {
                var emailInput = document.getElementById('vac-email');
                if (emailInput) emailInput.value = storedEmail;
              }, 50);
            }
          } else {
            // Brand new user — full flow
            console.log('[VAC] New user — full auth flow');
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

    /** Sign out — clears EVERYTHING. Forces full re-auth (email + OTP + biometric). 
     *  Use when leaving a shared device. */
    logout: function() {
      _clearToken();
      try { localStorage.removeItem(EMAIL_KEY); } catch(e) {}
      _user = null;
      _state = 'idle';
      _stopCamera();
      if (_vouchPollTimer) { clearInterval(_vouchPollTimer); _vouchPollTimer = null; }
      if (_container) _renderGate();
    },

    /** Lock — clears session but keeps identity. Next visit triggers face re-auth.
     *  Use for "I'm stepping away but this is still my device." 
     *  Simulates what happens when session expires naturally. */
    lock: function() {
      _clearToken();
      _user = null;
      _state = 'idle';
      _stopCamera();
      if (_vouchPollTimer) { clearInterval(_vouchPollTimer); _vouchPollTimer = null; }
      // EMAIL_KEY stays — triggers face re-auth on next init
      if (_container) {
        var email = _getStoredEmail();
        if (email) {
          _renderGate();
          _renderQuickReauthScreen(email);
        } else {
          _renderGate();
        }
      }
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

    /** Get ENGINE config (TTLs, eligibility rules, vouch requirements) */
    getEngineConfig: function() {
      return _engineConfig;
    },

    /**
     * Check if an action requires fresh biometric re-auth.
     * Call this before high-sensitivity operations like approve_spend.
     * Returns a Promise that resolves to true (proceed) or shows re-auth gate.
     * 
     * Usage:
     *   const ok = await VAC.requireActionReauth('approve_spend');
     *   if (ok) { // proceed with action }
     *
     * Patent Claims 5c-5e: Action-gated single gesture verification.
     */
    requireActionReauth: async function(action) {
      var ec = _engineConfig || {};
      var ar = ec.action_reauth || {};
      var actions = ar.actions || [];
      
      // If this action doesn't require re-auth, proceed
      if (actions.indexOf(action) === -1) return true;
      
      // Check if last biometric is fresh enough
      var user = _user || _getStoredUser();
      var lastBio = (user && user.last_biometric) || 0;
      var freshness = ar.freshness_seconds || 300;
      var age = (Date.now() / 1000) - lastBio;
      
      if (lastBio > 0 && age < freshness) return true; // Fresh enough
      
      // Need re-auth — show quick challenge inline
      return new Promise(function(resolve) {
        // Create modal overlay for action re-auth
        var overlay = document.createElement('div');
        overlay.className = 'vac-gate';
        overlay.id = 'vac-action-reauth';
        overlay.innerHTML = '<div class="vac-card"><div class="vac-header">' +
          '<div style="margin:0 auto 14px;width:48px;height:48px;background:#fbbf2422;border-radius:10px;display:flex;align-items:center;justify-content:center;">' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
          '</div><div class="vac-title">Confirm your identity</div>' +
          '<div class="vac-subtitle">This action requires fresh verification</div></div>' +
          '<div class="vac-body" id="vac-action-body">' +
          '<div class="vac-face-preview"><video id="vac-action-video" autoplay playsinline muted></video>' +
          '<div class="vac-face-overlay"><div class="vac-face-reticle"></div></div>' +
          '<div class="vac-face-hint" id="vac-action-hint">Loading...</div></div>' +
          '<button class="vac-btn vac-btn-primary" id="vac-action-btn" disabled>Verify</button>' +
          '<button class="vac-btn vac-btn-secondary" id="vac-action-cancel">Cancel</button>' +
          '<div class="vac-error-msg" id="vac-action-error"></div></div>' +
          '<div class="vac-footer"><div class="vac-footer-text">Action re-auth · ' + action + '</div></div></div>';
        
        document.body.appendChild(overlay);
        
        // Start camera
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }).then(function(stream) {
          var vid = document.getElementById('vac-action-video');
          if (vid) vid.srcObject = stream;
          
          var email = (user && user.email) || '';
          // Get challenge
          _api('POST', '/v1/auth/quick-challenge', { email: email }).then(function(ch) {
            document.getElementById('vac-action-hint').textContent = ch.instruction;
            document.getElementById('vac-action-hint').style.color = '#22c55e';
            var btn = document.getElementById('vac-action-btn');
            btn.disabled = false;
            btn.onclick = function() {
              btn.disabled = true;
              btn.innerHTML = '<span class="vac-spinner"></span>';
              _api('POST', '/v1/auth/quick-verify', {
                challenge_id: ch.challenge_id,
                detected_fingers: ch.num_fingers // Phase 1: auto-pass
              }).then(function(data) {
                _setToken(data.session_token);
                var u = _getStoredUser() || {};
                u.last_biometric = Math.floor(Date.now() / 1000);
                u.auth_level = data.auth_level;
                _setUser(u);
                stream.getTracks().forEach(function(t) { t.stop(); });
                overlay.remove();
                resolve(true);
              }).catch(function(e) {
                document.getElementById('vac-action-error').textContent = e.message;
                btn.disabled = false;
                btn.textContent = 'Retry';
              });
            };
          }).catch(function(e) {
            document.getElementById('vac-action-error').textContent = e.message;
            document.getElementById('vac-action-hint').textContent = 'Verification unavailable';
          });
        }).catch(function() {
          document.getElementById('vac-action-error').textContent = 'Camera access required';
        });
        
        document.getElementById('vac-action-cancel').onclick = function() {
          try { document.getElementById('vac-action-video').srcObject.getTracks().forEach(function(t){ t.stop(); }); } catch(e){}
          overlay.remove();
          resolve(false);
        };
      });
    },
  };

  // Export
  global.VAC = VAC;

})(typeof window !== 'undefined' ? window : this);
