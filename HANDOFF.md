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
