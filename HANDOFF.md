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
