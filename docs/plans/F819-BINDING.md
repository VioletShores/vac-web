# F-819: Water Demo — Mint Binding to Live Ceremony Session

## Goal

After a genuine biometric ceremony via `waterOpenVerify()`, `mintWaterToken()` must
re-run carrying the verified `email` and `session_token` so the issued token's
`human_ref` is derived from the live ceremony rather than the static fallback identity.

Mirror of tribunal-demo's `sealReauthGate` → `window.__vacVerified` → `mintMatterToken` pattern.

---

## Data-Flow Diagram

```
[User]
  │
  ├── CTA click → waterOpenVerify()
  │                    │
  │          [/auth.html iframe — production VAC auth surface]
  │                    │
  │          biometric ceremony executes
  │                    │
  │          postMessage: vac-auth-success
  │               { type, email, session_token, name, auth_level, ... }
  │                    │
  │          8s guard: Date.now() − openedAt < 8000 → reject
  │                    │
  │          window.__vacVerified = { name, email, session_token }
  │          + close overlay + show waterBioChip
  │
  └── advance() walkthrough (independent of ceremony)
           │
       step 4 ─► mintWaterToken()
                     │
                     read window.__vacVerified
                     │
            ┌─ ceremony ran (__vacVerified set) ──────────────────┐
            │  human_identity        = __vacVerified.email        │
            │  authorising_session_token = __vacVerified.session_token │
            │  SEAL_TOKEN.liveCeremony = true                     │
            └─────────────────────────────────────────────────────┘
            ┌─ no ceremony (fallback path — UNCHANGED) ───────────┐
            │  human_identity = 'noc-engineer@waternetwork.demo'  │
            │  no authorising_session_token field                 │
            │  SEAL_TOKEN.liveCeremony = false                    │
            └─────────────────────────────────────────────────────┘
                     │
                POST /v1/vat/issue → JTI minted
                     │
       step 5 ─► showReceipt()
                     │
            ┌─ tok.minted && tok.liveCeremony ────────────────────┐
            │  Authorised by: "{email} · verified live (VAC)"     │
            │  Token status:  "Minted under this live session"    │
            │  Verify link + "minted under live session" note     │
            └─────────────────────────────────────────────────────┘
            ┌─ tok.minted (no ceremony) ──────────────────────────┐
            │  Authorised by: "Verified NOC engineer (rep. scenario)"│
            │  Token status:  "Live mint — freshly signed"        │
            └─────────────────────────────────────────────────────┘
            ┌─ !tok.minted (fallback reference token) ────────────┐
            │  existing reference-token path — UNCHANGED          │
            └─────────────────────────────────────────────────────┘
```

---

## Mirror of tribunal-demo Pattern

| What | tribunal-demo | water-demo (F-819) |
|------|--------------|-------------------|
| Capture gate | `sealReauthGate` message listener | `waterOpenVerify` IIFE message listener |
| Capture target | `window.__vacVerified = { name, email, session_token, auth_level }` | `window.__vacVerified = { name, email, session_token }` |
| Mint fn reads | `__vacVerified.email` → `human_identity`<br>`__vacVerified.session_token` → `authorising_session_token` | same |
| Fallback | n/a (tribunal gate is mandatory) | `'noc-engineer@waternetwork.demo'` (no session_token) |

---

## Files Touched

- `trusted-water-demo.html` — three surgical edits:
  1. **Ceremony IIFE**: capture `window.__vacVerified` on `vac-auth-success` (alongside chip reveal)
  2. **`mintWaterToken()`**: read `__vacVerified`; bind `email` → `human_identity`, `session_token` → `authorising_session_token`; set `SEAL_TOKEN.liveCeremony`
  3. **`showReceipt()`**: reflect live-session binding in "Authorised by" and "Token status" rows + verify link note

- `docs/plans/F819-BINDING.md` — this file (L-499)

---

## What Is NOT Changed

- The 8s persisted-session guard in the ceremony IIFE
- Overlay open/close mechanics (`waterOpenVerify`, `voClose`)
- The `REAL_TOKEN` reference-token object and fallback path
- The fallback `human_identity` string when no ceremony ran
- `STEPS`, `STEP_BTN_LABELS`, `advance()`, `reset()` logic
- `SEAL_TOKEN` shape for the non-ceremony paths (only adds `liveCeremony` field)

---

## Auth-Class Note

This is an auth-class change (adds `authorising_session_token` to the mint call).
The `/cso` gate runs at merge time — not in this branch task.
