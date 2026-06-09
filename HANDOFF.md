# VAC Web — HANDOFF (Session 17 → Session 18)
> Updated: 15 March 2026 ~4:30pm AEDT

## PAGES STATUS

| Page | Route | Auth | Status |
|------|-------|------|--------|
| Hub | /hub | OTP | ✅ Working |
| Auth | /auth | — | ✅ Working, finger ticks upgraded (#83), MediaPipe detection built |
| Rob's Intel | /my | **Disabled** | ⚠️ Shows blank — auth gate disabled but Safari cache issue |
| Shan's Intel | /shan | **Disabled** | ⚠️ Same issue as /my |
| Dad's Copilot | /dad | **Disabled** | ✅ Working — family dashboard with memory log, shares, Sam's advice |
| Regatta | /regatta | OTP + face | ✅ Working |
| Derm | /derm | OTP + face | ✅ Working |
| Privacy | /privacy | None | ✅ Working |
| About | /about | None | ✅ Working |
| ENGINE | /engine | Admin | ✅ Being upgraded to live worker topology (#101) |

## SESSION 17 CHANGES

### SDK (vac-auth.js)
- `_clearToken()` only removes session token, not user identity
- `_clearAll()` for explicit logout
- Trusted users (1+ vouches) skip face requirement on page navigation
- Default camera speed: 'relaxed'
- Reads ?inviter= and ?inviter_name= URL params for auto-vouch
- Trust status fetched after face re-auth

### Auth (auth.html)
- Finger ticks: 44px green with glow (was 36px)
- Active digit: 56px pulsing purple (was 52px)
- Instruction text: white bold (was faint grey)
- Pulse animation added
- Real-time finger detection via MediaPipe (#83) — built, needs testing

### Dad's Page (athena-dad.html)
- Auth gate DISABLED (content visible immediately)
- Family dashboard: memory log, upcoming reminders, From Sam section, family activity log
- Share portfolio: BHP, CBA, Telstra with values, dividends, family alert rules
- All placeholder data — real data comes when WhatsApp + Gmail connected
- Fishing tides at The Spit, Middle Harbour
- Password vault (face-gated)
- Phone help section (#96 building)

### Known Issues
- /my and /shan blank page: auth gate disabled but Safari may cache old version. Use ?v=N parameter.
- Root cause: Railway session wipes on deploy. Need persistent session store.
- Auth gate disabled on /my, /shan, /dad as workaround.

## NEXT SESSION
1. Check if /my and /shan load (try ?v=6)
2. Check dad's page updates from tasks #95, #96
3. Re-dispatch #91 (Sam's paper analysis + ratings on derm page)
4. Test MediaPipe finger detection on auth page
5. Fix root cause: persistent sessions instead of in-memory

---
## S110 addendum (8 Jun, chat-Claude) — gesture-auth architecture findings (Caroline demo context)
- **MediaPipe vs Gemini roles clarified:** MediaPipe HandLandmarker = local, in-browser, free, real-time per-frame finger tracking (21 landmarks) for instant UX feedback (the tick). Gemini = cloud, authoritative liveness/deepfake/duress verification of the recording, once. Complementary: Gemini physically can't do per-frame interactive feedback (latency+cost); MediaPipe can't judge liveness. Two failure points BOTH on the MediaPipe side (CDN load + orientation math), neither touches Gemini.
- **F-NEW (pre-flight): add a MediaPipe readiness check to the auth pre-flight**, mirroring the existing mic/camera AV test (auth.html ~391-1365 "Speak now to test your microphone"). Sequence: camera ✓ → mic ✓ → MediaPipe model loaded ✓ → live "show your hand" detection-firing confirmation → THEN begin challenge. Directly de-risks the #1 gesture-auth flakiness (CDN load failing silently → timer fallback). Catch it in friendly pre-flight, not mid-auth.
- **MATERIAL FINDING — multi-modal verdict is partly simulated (D-NEW candidate, shipped-vs-running class):** `/v1/single-gesture/verify` (vac-backend main.py ~1096) computes a server-side weighted composite (video_liveness 0.35, voice_biometric 0.25, otp 0.20, geolocation 0.20). BUT: voice_biometric is `voiceprint_match: True # simulated`, score hardcoded to 0.85 if OTP matched (NOT a real voiceprint check); geolocation score is soft. REAL work today = Gemini video liveness/deepfake/duress + OTP. Voiceprint + geo are stubbed. vat_engine has an explicit "Simulated (Demo Mode)" posture. → For Caroline phase-2: honest claim is "face liveness really AI-verified (Gemini); other modalities scaffolded" — do NOT imply all 6 modalities independently real (consistent with never-claim-Posture-C). → Capture as debt: modalities appear in composite without doing real work (same F-152 shipped-vs-running blind-spot class).
- Test bench live at vacprotocol.org/finger-test (orientation-invariant math, awaiting Rob's live multi-angle test). Demo live at vacprotocol.org/tribunal.

## S110 addendum 2 (8 Jun) — voiceprint reality check (Rob asked: is it working? reuse from FolioAI?)
**ANSWER: voiceprint speaker-IDENTITY is NOT implemented anywhere — not VAC, not FolioAI. Separate, non-trivial work.**
- **VAC `verify_voice` (engine.py:412)** = Gemini transcript check "were the expected WORDS spoken (by a live person)" = CONTENT match + liveness, NOT speaker identity. Composite `voiceprint_match:True # simulated` (main.py:1123). **No enrolled voiceprint reference is stored anywhere** (grep empty) — can't verify "same voice" without an enrolled baseline.
- **FolioAI**: Deepgram = transcription; ElevenLabs-class = TTS/generation; "vocal comparison against enrolled references" appears ONLY in vac_pay.py/patent SPEC text, not shipped code. **Nothing to lift — it doesn't exist there either.**
- **Real voiceprint = a build:** (1) enrollment capturing+storing a voice embedding per person, (2) verification extracting an embedding from the live clip + similarity vs stored, (3) a speaker-ID model (Deepgram is transcription-only; need dedicated speaker-verification e.g. pyannote/SpeechBrain embedding or a speaker-ID API). Touches auth-critical path → proper testing. NOT a config tweak, NOT doable "now" from chat.
- **HONESTY CONSTRAINT for Caroline + any pitch:** the REAL, strong claim today = AI-driven face liveness + deepfake + duress (Gemini). Voiceprint identity + true multi-factor = ROADMAP. Do NOT imply voice-identity is live. Consistent w/ never-claim-Posture-C + the existing "Simulated (Demo Mode)" vat_engine posture.
- **Debt:** voiceprint(+geo) appear weighted in the composite verdict (voice 0.25, geo 0.20) without doing real work = shipped-vs-running gap (same F-152 class). Real verdict today leans on Gemini-liveness(0.35)+OTP(0.20). Audit the VAC verification stack before Sam/regulated reliance.
