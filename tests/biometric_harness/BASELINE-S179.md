# BASELINE-S179 — biometric harness slice 1 (F-1202)

Snapshot of the current vac-web pipeline's stage thresholds and the harness's
first fixture-run numbers, taken while building this slice (S179, 2026-08-30).
Future runs of `node tests/biometric_harness/run.js` should be compared against
this baseline — a stage whose source-anchored constants drift from the numbers
below, or a fixture that flips MATCH/MISMATCH, is a real behavior change and
should be reviewed (not silently accepted because CI is report-only).

## Source-anchored thresholds (read live from vac-reauth-ceremony.js / vac-face-embed.js at test time — this table is a snapshot, the stage modules are the source of truth)

| stage | constant | value | source |
|---|---|---|---|
| mic_qualify | `VOICED_RUN_TICKS_NEEDED` | 7 | vac-reauth-ceremony.js ~L781 |
| mic_qualify | `VOICED_RUN_MOD_DELTA` | 0.045 | ~L782 |
| mic_qualify | `VOICED_RUN_SPEECH_RMS_FLOOR` | 0.055 | mirrored via tests/fixtures/mic-test-audio-fixtures.js |
| mic_qualify | `VOICED_RUN_SILENCE_RMS_FLOOR` | 0.030 | " |
| mic_qualify | `VOICE_BAND_MIN_RATIO` | 0.45 | " |
| phrase_gate | `PHRASE_VOICED_TICKS_NEEDED` | 7 (= `VOICED_RUN_TICKS_NEEDED`) | ~L4976 |
| phrase_gate | `PHRASE_MOD_DELTA` | 0.045 (= `VOICED_RUN_MOD_DELTA`) | ~L4977 |
| phrase_gate | `PHRASE_SILENCE_TICKS_NEEDED` | 2 | ~L4978 |
| digit_voice | `DIGIT_VOICE_MIN_MS` | 200 | ~L3915 (S173: relaxed from 270; a real 247ms digit was previously rejected) |
| digit_voice | `DIGIT_VOICE_GAP_MS` | 200 | ~L3916 |
| digit_voice | `VOICE_EVIDENCE_MIN_FRAMES` | 8 | ~L5686 |
| digit_voice | modulation floor | `max(0.012, 0.10 * voiceMax)` (relative, S154) | ~L4221 |
| face_embed | `EXPECTED_DIM` | 128 | vac-face-embed.js ~L40 |
| face_embed | documented distance threshold | 0.6 (LFW 99.38% @ euclidean 0.6) | vac-face-embed.js header docblock |
| finger_gesture | `THUMB_BEND_MAX` | 48 | vac-finger-detect.js ~L180 (F-766b) |
| finger_gesture | `THUMB_SPREAD_MIN` | 0.42 | ~L181 (F-766b) |
| finger_gesture | `FOUR_FINGER_BEND_MAX` | 35 | ~L182 |
| finger_gesture | hysteresis `HYST_CHANGE_FRAMES` / `HYST_CLEAR_FRAMES` / `HYST_SETTLE_FRAMES` | 5 / 3 / 4 | ~L53-55 (F-613) |

Related but NOT wrapped by this slice's fast-tier constants (`_makeQuickReauthVoiceGate`,
`FAST_DIGIT_VOICE_MIN_MS=235`, S167 L-2538) — the quick-reauth path has its own tuning
history and would need its own stage module if a future slice covers it.

## First fixture run (S179, 2026-08-30)

12/12 specimen×stage combinations matched their manifest-declared `expectedOutcome`
(`tests/fixtures/biometric/manifest.yaml`) — 0 mismatch, 0 error. Full per-fixture
breakdown: `tests/biometric_harness/reports/latest.md` (regenerated on every
`node tests/biometric_harness/run.js` run; not committed — see .gitignore).

| specimen | stage(s) | expected | result |
|---|---|---|---|
| crisp_267ms_digit | digit_voice | PASS | fires at 200ms elapsed (267ms total run) |
| silence | mic_qualify, digit_voice, phrase_gate | FAIL | never qualifies on any stage |
| greeting_token | phrase_gate | PASS | passes at tick 6 (0-indexed), utterance-complete via trailing silence |
| noisy_room | mic_qualify | FAIL | stays in the "neither" dead zone, 0 ticks |
| ios_reencode | digit_voice | PASS | fires at 220ms after absorbing an 80ms dip |
| replay | digit_voice | CLIENT_GATE_PASSES_SERVER_AUTHORITATIVE | fires identically to crisp_267ms_digit — documents the trust boundary, not a false accept |
| genuine_pair | face_embed | PASS | euclidean distance 0.139 (< 0.6 threshold) |
| impostor_pair | face_embed | FAIL | euclidean distance 1.457 (>= 0.6 threshold) |
| clear_five_fingers | finger_gesture | PASS | raw count 5/5 |
| flicker_noise | finger_gesture | PASS | hysteresis holds committed count at 1 through periodic flicker to 3 |

## Known gaps (out of scope for slice 1, tracked for a future slice)

- No real speaker-verification model/adapter exists in vac-web — the reference
  adapter (`adapters/reference-digit-voice-adapter.js`) wraps the digit-voice
  heuristic gate as a placeholder for the F-1202 contract, not a claim that vac-web
  does speaker verification. The real model is tracked in
  vac-protocol/research/speaker-verification-eval.
- `replay` is a synthetic energy/shape replica, not an actual recorded-and-replayed
  capture — it demonstrates the client-side trust boundary, it is not an anti-spoof
  benchmark.
- Fast-tier (`_makeQuickReauthVoiceGate`) constants are not wrapped by this slice.
