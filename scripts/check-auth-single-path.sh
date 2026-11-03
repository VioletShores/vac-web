#!/usr/bin/env bash
# AUTH FORK-GUARD (S154, born from D-VAD-GATE-FORK: months-dead quick-auth voice
# behind a fork + scope bug). Fails the build when the auth capture path drifts
# toward a second implementation. CI-enforced: violation = red, not memory.
set -e; F=vac-reauth-ceremony.js; fail=0
pair() { a=$(grep -oE "const $1 = [0-9.]+" $F | grep -oE '[0-9.]+$' | head -1)
         b=$(grep -oE "const $2 = [0-9.]+" $F | grep -oE '[0-9.]+$' | head -1)
         if [ "$a" != "$b" ]; then echo "FORK DRIFT: $1=$a vs $2=$b (field-tunes must land on BOTH until D-VAD-GATE-FORK unification deletes the mirror)"; fail=1; fi }
# Intentional calibration asymmetry, not a fork bug:
# - FULL 200ms: Rob S173 / MacBook Air, after a genuine 247ms digit failed
#   270ms. S179 biometric-harness baseline preserves this full-path floor.
# - FAST 235ms: Rob S167; different quick-reauth onset/calibration behavior.
# Preserve BOTH exact values until owner field data and independent review
# approve a new dual-path calibration. Unexpected changes still fail closed.
pin_digit_voice_pair() {
  full=$(grep -oE "const DIGIT_VOICE_MIN_MS = [0-9.]+" "$F" | grep -oE '[0-9.]+$' | head -1)
  fast=$(grep -oE "const FAST_DIGIT_VOICE_MIN_MS = [0-9.]+" "$F" | grep -oE '[0-9.]+$' | head -1)
  if [ "$full" != "200" ] || [ "$fast" != "235" ]; then
    echo "FORK DRIFT: deliberate digit_voice full=200ms / fast=235ms calibration changed to $full/$fast; require owner field evidence and both-path regression review"
    fail=1
  fi
}
pair VAD_ONSET_SUSTAIN_MS FAST_VAD_ONSET_SUSTAIN_MS
pin_digit_voice_pair
pair DIGIT_VOICE_GAP_MS   FAST_DIGIT_VOICE_GAP_MS
n=$(grep -c "Math.max(0.012, 0.10 \* v" $F || true)
[ "$n" -ge 2 ] || { echo "FORK DRIFT: relative-modulation formula present at $n site(s) — must exist on BOTH paths (or ONE after unification)"; fail=1; }
g=$(grep -c "function _makeQuickReauthVoiceGate" $F || true)
[ "$g" -le 1 ] || { echo "FORK: multiple quick-gate factories ($g)"; fail=1; }
grep -q "typeof _micPillDraw === 'function'" $F || { echo "SCOPE GUARD MISSING: unguarded _micPillDraw (the months-dead-gate bug signature)"; fail=1; }
grep -q "fast_loop_error" $F || { echo "SELF-REPORTING MISSING: fast loop catch must emit fast_loop_error"; fail=1; }
[ $fail -eq 0 ] && echo "auth single-path invariants: OK"
exit $fail
