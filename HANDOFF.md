# VAC Web — HANDOFF (Session 22 → Session 23)
> Updated: 6 Aug 2026 — FLASH DONE: task-journey-harness merged + deployed

## FLASH DONE — task-journey-harness (L-JOURNEY USER-JOURNEY HARNESS + CONTINUE-TO-MATTERS FIX)
**Branch:** `task-journey-harness` → merged to main as 8901156 (2026-08-06)
**Root cause fixed:** After full E2E auth on auth.html, clicking "Continue to the matters" landed on `tribunal-demo.html#matters` but the IIFE only checked `?step=verified` (query param). The `#matters` hash + localStorage were never checked on load → `walkBody` stayed hidden → `#idPre` (biometric CTAs) remained visible → "Try the live biometric" re-offered → loop.
**Fix (S155):** Added 13-line hash check at end of idGate IIFE in tribunal-demo.html:
- `if(window.location.hash==='#matters')` — only fires on explicit continue-to-matters navigation
- Reads `localStorage.vac_verified`, validates 24h freshness + email presence
- Calls `reveal(_fresh, name, undefined, email)` — either as authenticated skip (idGate.done) or unauthenticated skip
- Smooth-scrolls to `#matters` after 50ms
- Wrapped in try/catch — localStorage failure silently degrades (page stays in auth-required state)
- `.textContent` used by reveal() for name — no XSS vector
**Harness (Phase 1):** `tests/user-journey.pw.js` — 7 Playwright tests, TC-UJ family:
- TC-UJ-F0: failing fixture (the loop) — passes after fix
- TC-UJ-01/02: cold landing cold state assertions
- TC-UJ-03: click skip → matters revealed without auth
- TC-UJ-04: full journey — auth state carried, matters content rendered, no loop
- TC-UJ-05: auth.html cold landing
- TC-UJ-06: no dead links sweep
**Test infrastructure:** `playwright.config.js`, `node_modules/@playwright/test/` shim (not committed), `.gitignore` updated, CI: `.github/workflows/journey-harness.yml`
**Tests:** 56/56 pass (49 Node + 7 Playwright)
**Gates:** /review PASS (no findings) | /cso PASS (test stub absent from prod: 0 hits) | /qa 56/56 | /browse cold-landing screenshot confirmed | /ship PASS
**Byte-verify LIVE:** `S155 continue-to-matters fix` confirmed live at vacprotocol.org/tribunal-demo; test stub `_testAuthSession` confirmed absent (0 hits)
**ATTEST:** Debt item L-JOURNEY closed. Recurrence pattern: prior report never became a fixture. TC-UJ-F0 is that fixture. Fix + fixture merged together.
**NEXT:** Rob clicks "Continue to the matters" once — should land on matters content, no re-offer of biometric. Confirm no loop.

---

# VAC Web — HANDOFF (Session 21 → Session 22)
> Updated: 6 Aug 2026 — FLASH DONE: task-prompt-state-sync-v2 merged + deployed

## FLASH DONE — task-prompt-state-sync-v2 (L-2246 PROMPT/STATE SYNC)
**Branch:** `task-prompt-state-sync-v2` → merged to main as 6d88bdd (2026-08-06)
**Root cause fixed:** `renderGreeting()` fires on every 200ms `phraseInterval` tick. When `clearInterval(phraseInterval)` fires and the digit phase begins, a final stale tick writes "Say the phrase" to `#step2Title` while `_ceremonyPhase` is already DIGIT.
**Fix:** Introduced single-source-of-truth phase state machine + map:
- `_PHASE` enum — canonical phase name constants
- `STATE_COACHING_MAP` — phase → { title, color } coaching text (one place to audit for collisions)
- `_ceremonyPhase` — module-level current phase variable
- `_setPhase(phase)` — transition function, calls `_renderPromptOnTransition`
- `_renderPromptOnTransition(phase)` — writes step2Title from map; single DOM-write path
- Guard in `renderGreeting()`: `if (_ceremonyPhase !== _PHASE.GREETING) return;` — stale ticks blocked
- Transitions wired: COUNTDOWN (startCountdown), GREETING/DIGIT (beginRecording if/else), DIGIT (_advanceGreeting), PROCESSING (finishFingerPhase)
**Tests:** 49/49 pass (12 new prompt-state: F0+P1-P11, plus 16 content-gate, 14 zone-geometry, 7 vad-replay)
**Gates:** /codex PASS | /review PASS (auto-fixes: dangling comment, P7 regex, P8 brace-count, Codex P2 early-set fix) | /qa 49/49 | /browse PASS (auth.html loads clean, no JS errors) | /ship PASS
**Byte-verify LIVE:** `STATE_COACHING_MAP`×2, `_setPhase`×9, `_renderPromptOnTransition`×2, `_ceremonyPhase`×4, `_PHASE`×11 — all confirmed at vacprotocol.org/vac-reauth-ceremony.js (537915 bytes)
**NEXT:** Rob adversarial run — confirm that during a real ceremony the digit-phase header never shows "Say the phrase" copy after phrase-phase ends.

---

# VAC Web — HANDOFF (Session 20 → Session 21)
> Updated: 6 Aug 2026 — FLASH DONE: task-voice-content-gate merged + deployed

## FLASH DONE — task-voice-content-gate (D-VOICE-GATE-SPEAKER-AGNOSTIC)
**Branch:** `task-voice-content-gate` → merged into `merge-vcg` → pushed to main as 544b80e (2026-08-06)
**Root cause fixed:** Rob's daughter singing behind a closed door drove RMS past the gold line and advanced the ceremony while Rob was silent. Gate was energy/RMS-only.
**Fix:** Content-gated voice progression via SpeechRecognition API. Transcript must match the expected digit (word or numeral) or phrase tokens (≥50% token match) before `_markSpeech` advances the ceremony.
**Key changes to vac-reauth-ceremony.js:**
- `_contentGateAvail` — module-level feature detection (SpeechRecognition || webkitSpeechRecognition)
- `_sessionGateAvail` — session-local shadow; runtime failures degrade gracefully without poisoning next session
- `_startDigitContentGate` / `_startPhraseContentGate` — SpeechRecognition handlers with dead-man switch
- `_refreshContentGate` — orchestrates digit gate with onFatal callback
- RMS/VAD demoted to mic-health indicator: sets `_vadEnergyDetected=true`, does NOT advance
- Honest coaching: "Listening — did not catch N yet — say it clearly" when energy heard but content unmatched
- Emoji removed: all 🎙️ / 🗣️ from coaching lines; setLamp uses 'G'/'V' text
- Privacy: non-matching transcripts discarded in-memory, never stored or transmitted
**Tests:** 37/37 pass (16 content-gate C1-C15+Privacy, 14 zone-geometry, 7 vad-replay)
**Gates:** /review PASS (ghost-recognizer fix, session-local state, onFatal callback) | /cso PASS (0 findings) | /browse PASS (auth page loads, no JS errors) | /ship PASS
**Zone geometry:** NO REGRESSION — all 14 geometry tests still pass
**Byte-verify:** `_sessionGateAvail`, `_startDigitContentGate`, `_startPhraseContentGate`, `_contentTranscriptHasDigit`, `_contentGateAvail` all confirmed live at vacprotocol.org/vac-reauth-ceremony.js
**PRESERVED:** F-823 i18n work (vac-ceremony-i18n.js + en/it string table) is on local branch `f823-wip` — NOT lost, not yet merged to origin/main.
**NEXT:** Rob ambient-audio adversarial run: daughter singing/background noise should NOT advance ceremony. Only Rob saying the correct digit should advance. Confirm content gate holds.

---

# VAC Web — HANDOFF (Session 19 → Session 20)
> Updated: 6 Aug 2026 — FLASH DONE: task-zone-harness-then-fix deployed to main

## FLASH DONE — task-zone-harness-then-fix (L-2446)
**Branch:** `task-zone-harness-then-fix` → cherry-picked to main as 2791928 (2026-08-06)
**Defect:** Ovals vanished in Rob's live run after 94ba1b9 (worse than oversized). Revert d8a1374.
**Root cause confirmed by harness:** 94ba1b9 clamped cxLeft = Math.max(rx, ...) putting oval CENTER at rx=0.172 from left edge. At near distance: left half of oval off-screen + inner edge overlapped face by 13% face-width → visually "vanished".
**HARNESS (Phase 1):** tests/zone-geometry.test.js — 14 assertions, node --test, no deps. Source-extract pattern: extracts _activeZone() body from source + injects synthetic _faceAnchor. Far/mid/near + edge-left/right fixtures. A1 in-frame, A2 size <= 0.55 fW, A3 gap >= 0.10 fW. CI wired (auth-fork-guard.yml).
**PHASE 2 results:** Reverted main FAILS A1/A2/A3 (oversized). 94ba1b9 FAILS A2/A3 (vanish via edge-clamp + face-overlap). Both reproduced by harness.
**FIX (Phase 3):** rx = Math.min(0.15, 0.22 * wFrac); ry = Math.min(0.20, 0.30 * hFrac); gap = Math.max(_FACE_SIDE_GAP, 0.15 * wFrac). Clamp: cx±rx in [0,1] with 0.5% margin. 21/21 tests green.
**Gates:** /review PASS (no findings) | byte-verified live
**Deploy:** Pushed to main 2026-08-06; Vercel auto-deploy triggered; byte-verified at vacprotocol.org/vac-reauth-ceremony.js
**NEXT:** Rob ONE final live run. Confirm ovals appear naturally beside cheek at arm's length.

---

## FLASH DONE — task-handzone-faceanchored (S155/S156)
**Branch:** `task-handzone-faceanchored` (merged to main 2026-08-05)
**Defect:** D-HAND-SLOT-AFFORDANCE (Rob 4th report S131/S133/S151 — recurring hand-not-registering)
**Root cause (chat-verified):** cheek ovals FRAME-ANCHORED (fallback cx 0.18/0.82) — face-anchor already merged but per-beat telemetry missing; "wrist" label in debug overlay is stale post-palm-centre switch
**Execution:** exists-audit confirmed face-anchor (task-432) + palm-centre + in-zone glow all in main; GAPS = per-beat zone telemetry at detect_digit_advance + "wrist→palm" debug overlay fix
**Gates:** /codex PASS | /cso PASS | /review PASS (2 auto-fixes: NaN guard expanded to all 4 MCP knuckles x+y) | /browse PASS (ceremony chrome; spatial test needs Rob live session)
**Deploy:** Merged + pushed to main 2026-08-05; Vercel auto-deploy triggered
**Next:** Rob re-runs ceremony — zone should sit naturally beside cheek; debug overlay now shows palm(x,y) not wrist(x,y); /v1/auth/debug receives hand_zone_snap events every ~2s

---

## S144 F-755d ZONE FIX — AWAITING ROB IPHONE TEST (L-2173)
> Updated: 23 July 2026 — S144 F-755d fix shipped to branch

## S144 F-755d ZONE FIX — AWAITING ROB IPHONE TEST (L-2173)

**Branch:** `task-s144-f755d-fix` (NOT merged — Rob must live-test first)  
**Gate doc:** `docs/gates/GATE-S144-F755D-FIX.md`  
**What changed:** Removed stale pre-S139 centre-oval SVG guide from both camera boxes. Canvas draw functions (`_avDrawHand` + `_drawFingerTargetGuide`) already drew correct cheek ovals from `GESTURE_ZONE_SPEC` but were hidden behind the stale SVG (z-index:5 vs canvas z-index:4). Fix: SVG removed, z-index lowered to 3. Dead code (`_HAND_ZONE_RX/_HAND_ZONE_RY/_ptInHandZone`) also deleted.  
**Visual test aid:** Both canvases now show `ZONE: IN ✓` (green) or `ZONE: OUT` (grey) + `wrist(x,y)` in the bottom-left corner so Rob can verify geometry on iPhone.  
**Live test URL:** https://vacprotocol.org/auth.html (deploys when Rob merges to main)  

---

# VAC Web — PRIOR HANDOFF (Session 17)
> (preserved below)

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

## S110 addendum 3 (8 Jun) — finger-test bench VALIDATED LIVE + skeleton overlay = port into auth.html (gesture fix)
**Rob tested /finger-test live (screenshot confirmed):** orientation-invariant finger math WORKS — thumb+2 fingers correctly = 3 (thumb 25°/0.67 → up, index 1° → up). Thumb angle+spread fix (f24f2f8) good enough. The four-finger vector-angle math holds at angles (the hard problem, solved). Rob loves the SKELETON OVERLAY (dots+connector lines on the hand) — "shows real tech."
**KEY: the bench uses the SAME MediaPipe HandLandmarker auth.html already loads — not a different system.** So bringing it into auth is a PORT, not a rebuild. Three things to bring from /finger-test → auth.html:
  1. Skeleton overlay (dots + connectors) — UX/credibility win, shows the user they're being tracked live during biometric auth.
  2. Fixed orientation-invariant finger math (vector-angle MCP→PIP vs PIP→TIP) — REPLACES the broken tip.y<pip.y at auth.html L801-807.
  3. Improved thumb logic (joint-angle + spread) — validated live tonight.
**This IS the D-VAC-GESTURE-MEDIAPIPE fix (S101 packet `93e43ed`), now DE-RISKED — the math is proven live.** Remaining per the packet: bundle the MediaPipe SELF-HOST fix (L-721, so auth path isn't CDN-fragile) + the F-NEW MediaPipe pre-flight check (mirror the AV mic/cam test) into the SAME port.
**DO NOT port tonight (engineering discipline):** auth.html is the LIVE auth critical path (feeds Gemini verify + recording + composite). Needs proper L0: branch, orientation-fixture probe, multi-LLM gate, live test ≥2 devices/≥4 orientations, self-host bundled. NOT a late-night edit. = clean first task of a focused VAC session / Conductor lane. Then flows into Caroline phase-2 (real biometric step in the tribunal demo).
**Bench reference impl lives at vac-web/finger-test.html** (countFingers + thumbState + drawLandmarks) — copy these into auth.html.

## S110 addendum 4 (8 Jun) — auth end-to-end test result on /auth-test
**WIN:** finger detection drove the flow end-to-end for the first time — progressed through each digit based on REAL hand detection (not timer). Console confirmed HandLandmarker active + "Graph successfully started running". Skeleton overlay (dots+lines) shows on hand; perf fixed (cached ctx, willReadFrequently) + enlarged + phone-responsive sizing. Challenge text box now recedes to 25% opacity when hand visible (clean skeleton view).
**BLOCKER (backend, not auth front-end): GEMINI_API_KEY not set on prod VAC backend** → verification runs SIMULATED (engine.py:320 `self.simulated = not GEMINI_API_KEY`; 656 `if not HAS_GENAI or not GEMINI_API_KEY`). Result: face liveness / deepfake / lip sync / finger-gesture all return "service unavailable (will retry)" → 2/7 passed, trust 0.2. Deepgram WORKS (transcribed "Robert Sagarella 25" vs expected) so Deepgram key IS set; only Gemini missing (or genai lib not installed). SAME CLASS as SerpAPI-400 + dispatch-db + voiceprint: a prod dependency unwired, failing silently behind a friendly message. FIX = set GEMINI_API_KEY in Railway VAC backend env (+ confirm genai installed) — needs Rob/Mini w/ Railway dashboard + the key. Front-end auth (detection+overlay+flow) is DONE on /auth-test; verification engine can't verify until the key is set.
**Also:** challenge expects exact phrase incl all digits spoken individually ("2 5 1" not "251"/"25") — UX note for the demo.
**Next:** (1) set GEMINI_API_KEY on prod → retest /auth-test full pass; (2) promote /auth-test → /auth; (3) self-host MediaPipe + pre-flight (S101 packet); (4) phone test; (5) wire real auth into Caroline tribunal demo step 1.

## S110 addendum 5 (8 Jun) — /auth-test FULL RUN via Claude-desktop observer: GEMINI WORKS + real remaining bug identified
**MAJOR WIN: Gemini key fix worked.** Full run = trust 0.7, 6/7 passed: Face Liveness 0.90✓ Deepfake 0.90✓ Voiceprint 0.98✓ Lip-Sync 0.95✓ Challenge 0.60✓ Duress 0.95✓ — the 5 Gemini-backed modalities now return REAL scores (the "service unavailable" GEMINI_API_KEY blocker is RESOLVED). (Voiceprint 0.98 still the SIMULATED path per F-556 — real voiceprint still F-556 work.) Detection-driven advancement CONFIRMED via console: phase2_entering→grace_complete→path_detection→detect_first_finger_advance→detect_all_digits_complete→step4, NO timer-expiry, NO fallback/too-slow lines (retry-latch fix + slow-limit raise appear to hold).
**THE REAL REMAINING BUG (next-session fix): detection↔recording desync.** Finger Gesture FAILED 0.43: "expected [2,3,5] but Gemini saw [2]". Root cause: local MediaPipe detection advances FAST (paced by Rob's hand, ~3s for 3 digits) and fires detect_all_digits_complete → jumps to step 4, but the RECORDING (video sent to Gemini) runs on a FIXED clock (auth.html ~1508-1511: PHRASE_DURATION + digits×DIGIT_DURATION) and gets stopped early — so the recorded video only captured digit [2] before detection ended it. The two subsystems are out of sync: detection paces itself; recording is fixed-duration; detection-ends-early truncates recording before Gemini has footage of all digits. FIX = recording must stay open long enough to FILM each digit detection advances through (e.g. stop recording when detect_all_digits_complete AND a per-digit minimum dwell has elapsed, OR drive recording duration from detection progress not a fixed clock). Touches 3 interlocking pieces (detection pacing, recording duration, stop trigger) — real fix, needs care + multi-angle/phone test, NOT a late-night patch.
**TIMER SIMPLIFICATION (next-session): remove the decorative "RECORDING" countdown ring during the FINGER phase** — observer confirmed it runs but does NOT drive advancement (detection does), so it's misleading. KEEP the "RECORDING IN 2-1" pre-roll (get-ready beat) + the phrase/voice window (genuinely time-based). Only the finger-phase countdown is redundant.
**State:** /auth-test has fixed orientation-invariant math + skeleton overlay (perf+sized) + text-recede + retry-reset. NOT yet promoted to /auth. Next: detection-recording sync fix → timer cleanup → self-host MediaPipe + pre-flight → phone test → promote → wire into Caroline tribunal demo phase-2.

## S110 addendum 6 (8 Jun) — GEMINI FLAPPING + auth-test state for next session
**Gemini modalities went DOWN again** (worked 6/7 trust 0.7 at ~21:09; now Face Liveness/Deepfake/Lip-Sync/Finger all "service unavailable — will retry", trust 0.34→0.19 across 2 runs). Backend health 200, front-end fine. Most likely cause given MANY test runs tonight: **Gemini API QUOTA / rate-limit** (each full run = 4+ Gemini calls; key may be free-tier or shared with Athena routing) OR key unset on a redeploy. NOT a code bug — backend dependency flapping silently behind "will retry". 3rd instance tonight of the F-152 silent-dependency pattern (SerpAPI, dispatch-db, now Gemini). **NEXT (Rob/backend): check VAC backend logs for the actual Gemini error — if quota, need higher-tier or dedicated VAC Gemini key (not shared w/ Athena). This is the blocker — downstream auth fixes untestable until Gemini is STABLE.**
**Detection/timing fixes landed but PARTIALLY effective + a bigger timer found:**
- Sync fix (MIN_DIGIT_DWELL_MS=700 + 1500ms tail) pushed (9b31d51) — but observer still saw held_frames:12 advance; dwell may not be gating fully. Re-verify once Gemini stable.
- **NEW: a MASTER ~10s phase countdown** ends the finger phase regardless of detection (observer: phase auto-advanced to step4 when 10s hit zero in run 1). This is the bigger timer to address — individual digits advance on detection+hold%, but the phase is bounded by this hard 10s clock. Find + reconcile (let detection completion end the phase, with the 10s only as a max-timeout safety, not the primary driver).
- Counts mismatch [2,1,2] vs expected [1,2,4]: note this was the CHROME-CLAUDE agent holding fingers — partially the anti-spoof working (an agent isn't Rob doing the real gesture). A clean pass needs Rob live. But the "capped at 2 / never saw 4" pattern also suggests the overlay/count still under-reads higher counts at some angles — re-test live.
**auth-test state:** orientation-invariant math + skeleton overlay (perf/size/recede) + retry-reset + sync-dwell, all on /auth-test (NOT promoted to /auth). Front-end close; blocked on Gemini stability. Next-session order: (1) fix Gemini availability/quota [backend], (2) re-verify detection+sync live with Rob, (3) reconcile master 10s timer, (4) self-host MediaPipe + pre-flight, (5) phone test, (6) promote /auth-test→/auth, (7) wire into Caroline tribunal demo phase-2.

## S110 addendum 7 (8 Jun) — Gemini diagnosis CORRECTED + excellent UX critique (Chrome-Claude, 3 runs)
**CORRECTION: it's quota/rate-limit, NOT video size.** Bitrate cap (f8f0ec4) did NOT fix it. 3 runs: Gemini block (Face Liveness/Deepfake/Lip-Sync/Finger) flips ALL-OR-NOTHING — all err (runs 1,3) vs all 0.90-1.00 healthy (run 2), uncorrelated with recording length. That block-flip = upstream THROTTLE (single dependency intermittently rejecting), classic 429/quota, NOT size. We hammered Gemini with many test runs tonight; key likely free-tier or shared w/ Athena routing. F-558's bitrate cap was right fix for wrong cause; File API still good hygiene but the REAL fix = **dedicated VAC Gemini key + higher quota tier** + error differentiation (client never sees WHY — no 429 surfaced, just "service unavailable" = the F-152 blindness in one line). Oddity: non-Gemini signals INVERTED on the good run (Voiceprint+Challenge 0.00 in run 2, fine in 1,3) — no single run got everything green; best was 0.48. Worth a look but secondary to the Gemini throttle.
**ACTION (Rob/backend, the real blocker):** (1) VAC backend Railway logs → find the actual Gemini error (expect 429 RESOURCE_EXHAUSTED). (2) provision a DEDICATED VAC Gemini key (not shared w/ Athena) and/or higher tier. (3) F-558 error-differentiation so failures say WHY. Until Gemini quota is sorted, NO run will get a clean 7/7 — and chasing it frontend-side is pushing on a rope.
**UX CRITIQUE (act on — frontend, independent of Gemini, HIGH VALUE for Caroline):**
1. **Don't show red "WHY IT FAILED" when fault is OURS.** 4× red "service unavailable" reads as "user rejected" on a security product. Replace w/ honest reassuring copy ("Some checks couldn't run — that's on us. Retrying…") + silent auto-retry, not a red failure panel. BIGGEST impression fix.
2. **Finger-hold never resolves to a confirmed lock** — stalls at "hold steady 92%" then timer races past before last digit locks. = the master-10s-timer racing detection. Bar must hit a clear per-digit "✓ got it" lock, OR timer waits for gesture.
3. **3 competing countdowns = test-anxiety** (RECORDING-IN preroll + live RECORDING countdown + per-digit hold%). Drive by DETECTION not clock; generous/pausable timer.
Step notes: Step2 "Proceed" sits disabled w/ no explanation until mic registers (add hint); "Streamlined: 1 of 6 modalities" = confusing jargon; privacy note ("no video retained") well-placed + reassuring. Step4 expandable modality table = nice transparency BUT red err rows + sub-0.5 score makes polished product look broken. Visual design praised (clean dark UI, hand-overlay, trust-score concept); RELIABILITY (flaky Gemini + racing timer + no gesture-confirm) is what undercuts trust.

## S110 addendum 8 (8 Jun) — detector warm-up REVERTED (regression) + the real fix for next time
**What happened:** attempted to fix the first-finger cold-start lag (Rob: dots appear late on digit 1, in sync by digit 2 — real symptom, MediaPipe's ~0.8-1.5s first-inference GPU/WASM warmup landing on the first digit) by running silent FingerDetector.detect() during the speak phase (commit 0637684). It REGRESSED — "MediaPipe didn't trigger at all", generic "Verification error". Root cause of the regression: MediaPipe detectForVideo is TIMESTAMP-SENSITIVE (requires monotonic increasing timestamps, single caller) — the warm-up loop competed with / corrupted the detector state so the real loop couldn't run (likely tripped FingerDetector.failed or threw on timestamp). REVERTED (9896de7) — /auth-test back to known-good (the 7/7 two-clean-runs state, b719026).
**The underlying fix is still VALID, just needs correct impl (next session, careful):** warming MediaPipe before the first digit is the right idea. Correct approach: (a) feed monotonic `performance.now()` timestamps consistently to ONE detect path; (b) don't run two detect loops — instead start the SINGLE real detection loop earlier (during speak), but suppress advancement/skeleton until the finger phase, so the same loop warms the model AND drives detection (no second caller, no timestamp conflict); OR (c) call a lightweight warm-up ONCE (a couple of frames) guarded so it can't trip _hasFailed, then hand a clean detector to the loop. Test live BEFORE moving on — this is detection critical path, not cosmetic.
**LEARNING (capture L-NNN): a "polish" change on the detection/auth critical path is NOT a safe change — verify live before proceeding.** Treated a critical-path edit like a cosmetic one, shipped without a live-confirm, regressed a working flow. Critical-path UI/detection changes need the same verify-before-trust discipline as backend — confirm on a live run before the next edit.

## S110 addendum 9 (8 Jun) — warm-up attempt #2 ALSO regressed → STOP trying from chat
Second attempt at the first-finger cold-start fix (voice-triggered one-shot warmOnce, commit 8ea1bf3) ALSO broke detection ("not detecting fingers, MediaPipe not triggering"). REVERTED (e10af96) — back to known-good 7/7 state. TWO consecutive regressions on the same fix from chat-Claude editing blind.
**HARD GUIDANCE: do NOT attempt the detector warm-up / cold-start fix from chat-Claude again.** The MediaPipe detector state (timestamp sequencing, _hasFailed latch, init/ready lifecycle) is too fragile/interconnected to edit safely blind — chat-Claude can't run it or see the console when it breaks, and each attempt burns the working state via a live deploy + manual test. This fix MUST be done on the Mini with Claude Code where it can run, watch console, and iterate in a tight loop. Likely the warmOnce/voice approach is even fine — but it needs live console debugging to see WHY detection stops (probably the warm call leaves the detector in a state the real loop's first detectForVideo rejects on timestamp, OR an exception path we can't see from chat).
**The cold-start lag is MINOR** (first finger slightly delayed, synced by 2nd) on a flow that otherwise works 7/7 end-to-end. NOT worth risking the working system. Defer to a focused Mini session.
**KNOWN-GOOD baseline = e10af96** (everything from tonight EXCEPT warm-up: orientation-invariant math, skeleton overlay, digit strip above video, calm progress timer, graceful failures, detection-recording sync, retry-reset; + F-558 backend live). This is the state to promote to /auth and demo to Caroline.

## S110 addendum 10 (8 Jun) — F-559 hand pre-flight BUILT + sequential gate; cold-start theory DISPROVEN
**SHIPPED (working, /auth-test):** F-559 hand pre-flight in the camera/mic step — Hand pill + live skeleton overlay (Rob confirmed "works great, asks to move back etc"). PLUS guided SEQUENTIAL gate (9c4f59e): avGuide banner walks Step 1 lighting → Step 2 mic → Step 3 hand → All set; Start gated on all three (was light+mic only). Additive, doesn't touch in-challenge loop, Hand-framing guidance now impossible to miss.
**IMPORTANT — cold-start theory is WRONG:** the first-finger lag PERSISTED even after the hand pre-flight warmed MediaPipe (Rob: "same problem occurred...mediapipe detected on the second number"). If cold-start were the cause, pre-flight warming would have fixed it. It didn't. So the 2 reverted warm-up attempts (addendum 8/9) were fixing the wrong thing. DO NOT build more warm-up fixes.
**Real cause UNKNOWN — needs console data before fixing (do NOT theorize/patch blind again — 2 regressions already):** clue = earlier observer saw detect_first_finger_advance `frames_before_first_detect: 487` (several seconds before first detection registered, model already warm). Candidates to investigate WITH console: (a) the 1.5s GRACE period interaction when hand is already up during speak phase; (b) the MIN_DIGIT_DWELL_MS / STABLE_FRAMES first-accept gate (lastAcceptedCount starts 0, detected!==lastAcceptedCount); (c) first-frame detection genuinely not registering for ~487 frames. NEXT: capture console ([VAC]/phase2/detect_first_finger_advance + timing) during the first digit on a live run, THEN diagnose. The fix must be evidence-led, not theory-led.

## S110 addendum 11 (8 Jun) — cache confusion + OTP timing notes + OUTSTANDING racing bug
**"Older version / no hand test" = BROWSER CACHE, not a revert.** Verified live /auth-test (df0515c) HAS all features: avPillHand, Step 1 of 3 sequential gate, GRACE_MS=600, LATCHED. Nothing reverted. Fix for Rob: DevTools → right-click reload → "Empty Cache and Hard Reload" (plain Cmd+Shift+R insufficient after many deploys). Worth adding a cache-busting version query or meta no-cache to /auth-test for testing sessions.
**First-finger lag FIXED + confirmed by Rob** ("yes that did it") — was the 1.5s grace DETECTION BLACKOUT (not cold-start; console proved detection works on first active frame). Fix: grace 1500→600ms + skeleton-draws-during-grace (fd911ab). Latch fix for hand pre-flight re-nag (df0515c) also confirmed fine.
**OTP inconsistencies (not bugs, but UX notes):** (1) "sometimes asks for code, sometimes not" = `[VAC] Email already OTP-confirmed, skipping to camera` — session remembers OTP confirmation, intended but feels inconsistent. (2) "wrong code" incident = Rob entered a STALE code from a previous attempt because email delivery was slow that time (usually fast). Email-delivery latency is variable → user may enter an old code. Consider: invalidate old codes clearly, show "new code sent" state, or note expected delivery time.
**OUTSTANDING BUG (not yet fixed — needs console data): "races through the last 1-2 digits," WORSE on retry.** Symptom: first digit fine now, but last digits accepted too fast before Rob can show them; retry worse. Suspect: per-digit MIN_DIGIT_DWELL_MS not enforced after the first digit (digitStartTime/dwell interaction once hand stays up and just changes count), and/or window.__vacDetectedCounts persisting across retries (it's on window, not reset in retryVerification). NEEDS: console capture of timestamps between each digit advance (first run vs retry) to confirm dwell is being skipped, BEFORE fixing (evidence-led, per tonight's lesson). Prompt for desktop-Claude observer prepared.

## S110 addendum 12 (9 Jun) — grace 300ms; "5"/open-hand detection fragility + advance-gate accepts wrong count
**Grace dropped 600→300ms (4861f1e)** per Rob. If first-finger delay "looks the same," likely still cached — confirm via /auth-test?v=N and check console grace_ms (300=new). 300ms is near the perceptible floor; residual is inherent camera-frame latency.
**FINDING A — "5" / open-hand pose is detection-fragile (esp. up close):** Rob showed 5 (all fingers), it would NOT lock/advance; he moved hand closer/back repeatedly, no luck; switched to 4, advanced cleanly. MediaPipe counts an open splayed hand less reliably up close (fingers clip frame edges / merge). Candidate fixes (NEXT session, real-hand iteration — do NOT tune blind): widen the count-tolerance for 5, or relax stability for 5 specifically, or improve the "spread fingers / move back" coaching when a near-5 partial is detected. Related to the framing guard already shipped.
**FINDING B — local advance gate accepts a HELD DISTINCT count, not the CORRECT count:** Rob completed the gesture showing 4 when challenge wanted 5; local detector advanced (it only checks "a distinct number was held ~dwell"), gesture "completed", then SERVER verification correctly FAILED (wrong count). Re-verification with correct numbers passed. By design (Gemini validates actual count server-side, L-255-style — local detection is liveness/cadence not ground truth), BUT the UX is confusing: user appears to succeed at the gesture then fails verification with no clear "you showed the wrong number" signal. Consider: surface a gentle client-side "that didn't match — show N" hint when the held count != target (without being authoritative), OR make the failure message name the gesture mismatch. UX decision for next session.

## S110 addendum 13 (9 Jun) — BUG CLUSTER on retry/last-digit/verified-state — DO NOT promote /auth-test→/auth until fixed
Rob hit a tangled cluster (needs careful evidence-led fix next session, NOT blind — late hour, interacting bugs, and my confirmation-beat change e0c1f02 may interact):
1. **LAST DIGIT finishes before audio.** On the final digit, the gesture being accepted ends the finger phase / advances to verification BEFORE Rob can SAY the number. So the last digit's spoken/audio component is never captured. SUSPECT: finishFingerPhase fires immediately on last-gesture-accept with no room for the voice; may be worsened by the new CONFIRM_BEAT_MS timing. Likely needs: on the LAST digit, don't end on gesture-accept — leave a window (or require the voice) before finishing.
2. **RETRY LOOP won't pass with correct numbers.** Rob showed correct digits, kept failing + re-running. Likely DOWNSTREAM of #1: if the last digit's audio never captured, server verification legitimately fails every retry → infinite-feeling loop. Confirm by checking whether the failures correlate with the audio-missing last digit.
3. **INTEGRITY BUG (highest priority): "Continue Anyway" → showSuccess() marks VERIFIED after a real FAILURE.** btnContinueAnyway (line ~563) appears after MAX_RETRIES=5 (line ~2339) and calls showSuccess() directly — so a FAILED verification reaches the success/verified state + writes vac_verified to localStorage + posts vac-auth-success. Rob: "got to 5 of 5, gave me Continue Anyway, says I am verified when I really failed." On /auth-test this is contained (test surface, no real users), but it MUST NOT reach /auth. Fix needs a decision: after max retries, show an honest FAILED terminal state — NOT a path to success. (Possibly "Continue Anyway" was a dev convenience; if so, remove it or gate it behind a non-prod flag.)
**GATE: do NOT promote /auth-test→/auth until #3 (integrity) is resolved + #1/#2 fixed and a clean real-hand run passes honestly.**
**Diagnostic approach (per L-774): get console + network data first** — for #1, timestamps of last detect_digit_advance vs finishFingerPhase vs recorder.stop; for #3, confirm whether showSuccess is reached with a failed authResult (client lying) vs server returning pass. Evidence before fix.

## FLASH: [athena-exec] task-540-auth-lineage-merge START (2026-08-03) — D-AUTH-LINEAGE-FORK diff-port beginning, product lineage auth.html (1693L) is base, porting audio-fix/verdict-reasons/S154 device-visibility from vac-protocol, gates-then-merge, no replace.

## FLASH: [athena-exec] task-ro-render-floors START (2026-08-04) — S155 L0 packet: (1) client render-only (success/failure screens consume server decision verbatim, delete client verdict composition, missing decision = DENY), (2) positive-evidence floors both paths (voice >=8 above-threshold frames, finger sustained >=400ms Schmitt release 1.3x/300ms), (3) per-speaker fast cal thr=clamp(rollingFloor*1.8, 0.05, 0.13) via shared helper both paths (D-VAD-GATE-FORK advance, no full unify), (4) Node replay harness (tests/vad-replay.test.js) against real /v1/auth/debug vad_gate telemetry, wired into CI beside fork-guard. DESIGN RULE block + check-auth-single-path.sh stay authoritative. Gates-then-merge; no human test — harness is confirmation.

## FLASH: [athena-exec] task-ro-render-floors DONE (2026-08-04) — merged `a1da869`, deployed + byte-verified live (vacprotocol.org/vac-reauth-ceremony.js has FAST_CAL_FLOOR_MULT/VOICE_EVIDENCE_MIN_FRAMES/FINGER_RELEASE_SUSTAIN_MS; auth.html has the "not verified" DENY-on-missing fallback string). All 4 items shipped:
1. **RENDER-ONLY:** `showSuccess()` normalises `authResult`/`biometric_verification` to safe empty shapes instead of crashing on null (was a swallowed TypeError leaving the user stranded on "Continue Anyway" with no decision ever parsed) — missing decision now renders the same explicit NOT-VERIFIED path as any other failure. `ok`/`passed` both switched to strict `=== true`.
2. **EVIDENCE FLOORS:** `VOICE_EVIDENCE_MIN_FRAMES=8` (frame-count floor, ANDed with existing duration+modulation, both tiers — counts real above-threshold samples including pre-onset accumulation, closes a stalled-rAF-timer-gap loophole). Finger release converted from a raw frame count (`_releaseFrames>=3`, fps-dependent — 150ms@20fps vs 50ms@60fps) to a wall-clock Schmitt trigger (`FINGER_RELEASE_SUSTAIN_MS=300` + `FINGER_RELEASE_MIN_FRAMES=4`, 1.3x the old floor). `MIN_DIGIT_DWELL_MS=700` already exceeded the 400ms hold floor, unchanged.
3. **PER-SPEAKER FAST CAL:** shared `_fastCalThreshold(rollingFloor)=clamp(rollingFloor*1.8, 0.05, 0.13)`, one definition, called from both tiers as the fallback tier between full preflight cal and the flat hardcoded constant. Verified against a real fixture (session `sess_osdy8boy_reauth`, 4 Aug ~10:25 UTC): floor 0.044-0.054 → thr 0.079-0.097, which lets the recorded 0.124 voice peak fire (the old flat-0.13 ceiling was clipping it) while the recorded ~0.07 ambient reading stays silent.
4. **REPLAY HARNESS:** `tests/vad-replay.test.js` (Node built-in test runner, zero deps) replays real `/v1/auth/debug` telemetry (`tests/fixtures/vad-replay-fixtures.json`, real event ids/timestamps) through constants extracted from source by name. 7/7 green, wired into `.github/workflows/auth-fork-guard.yml`.

**Mid-session collision, resolved:** `6186500` (the sealed-verdict lane's own `showSuccess()` fix — coarse denial-reason display, cross-LLM-gated, Rob-approved) landed on `main` while this branch was in flight, touching the exact same function. Caught via `git diff origin/main` before merge (would have silently deleted their fix), rebased and hand-merged both changes into one coherent `showSuccess()` — their coarse-reason branch is now defended by this lane's r/bio null-safety guard.

**Not found in accessible docs:** F-1037 and D-VERDICT-COMPOSITION (cited in the packet) don't appear in vac-web, vac-protocol, or athena's EXECUTION-DEBT.md/HANDOFF.md — only reachable via the Cowork/claude.ai layer this session can't read. Proceeded on the well-attested parts of the packet (D-VAC-VERIFY-COMPLEXITY-ROOT, the Skyssia telemetry fixture, which matched real backend data byte-for-byte) rather than blocking on unverifiable citations.

Gates: `node --check` + `check-auth-single-path.sh` + harness (7/7) + self-review + diff-scoped `/cso` pass, all green pre- and post-merge. No human test — harness is the confirmation, per the packet.
