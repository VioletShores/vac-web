# PKT-S194 — VAC Honest Verify: exists-audit

Lane: task-s194-vac-honest-verify. Audit performed 2026-09-17 against:
- `vat-verify.html` etc. in this repo (branch `task-s194-vac-honest-verify`, based on `origin/main`).
- The **live production backend** at `https://vac-system-production.up.railway.app` (probed directly with `curl`, see evidence below — this is the ground truth the page actually talks to).
- A local checkout of the backend source at `/home/vercel-sandbox/vac-system/vac-backend` (git remote `github.com/schemo512/vac-system`, HEAD `a07b952`). This checkout is **stale relative to production** — commit `4ae18a1` cited in the dispatch is not reachable in this checkout or on GitHub, but the live API response (below) matches the *behaviour* `4ae18a1` describes exactly, so production evidence is treated as authoritative and the local checkout is used only for reading logic (chain_hash formula, verify() walk) that the live API doesn't expose directly.

Per the binding critique-gate resolution: each claim below is marked CONFIRMED (defect present, code changed) or NOT PRESENT (claim doesn't match current code, left alone) with the evidence that decided it.

## Claim 1 — hard-coded "Ed25519 signature valid" / "chain intact" / "checked the cryptographic signature live"

**CONFIRMED.** `vat-verify.html:610-614` (verify-intent hero):

```
610: <span ...>Ed25519 signature valid</span>
611: <span ...>${v.chain_length} node...chain intact</span>
614: ...this page fetched the token from the production backend and checked the cryptographic signature live...
```

Backend evidence — `vat_engine.py:623-714` (`VATEngine.verify`, walked from the live-matching local source): the chain walk checks `current.jti in self.revoked`, `current.expired`, `current.needs_reverification`, monotonic trust, sequential depth, and that the chain starts at a root token. There is no call to any signature-verification routine anywhere in `verify()`. Confirmed live: `GET /v1/vat/verify/{jti}` for a freshly minted token returned `"valid":true` with no signature field in the response at all (see raw JSON in Claim 2's evidence block) — the page's "valid" therefore reflects only the server-memory status checks, never a signature check.

Fix: replaced the hard-coded badges with "Server status check: active, not expired, not revoked, parent links present" and added a real in-browser Ed25519 check (WebCrypto, tweetnacl fallback) gated on whether a compact JWT is actually available to the page.

## Claim 2 — assurance_level never shown

**CONFIRMED.** Live probe:

```
$ curl -s https://vac-system-production.up.railway.app/v1/vat/verify/vat_root_577ed3059119
{"valid":true, ..., "assurance_level":"L1","root_assurance_level":"L1","min_assurance_in_chain":"L1"}
```

`vat-verify.html` never references `assurance_level`, `root_assurance_level`, or `min_assurance_in_chain` anywhere in its script (grepped the full file — zero matches before this change).

Fix: added a prominent assurance-level line with the plain-English mapping specified in the dispatch (L1/L2/L3).

## Claim 3 — "simulated" method, trust 0.3, `context.client_claimed_method`

**CONFIRMED against live production** (local backend checkout is stale and does not show this path — see header note). Live probe, issuing a token with `verification_method: "multi_modal"` and no session token:

```
$ curl -s -X POST https://vac-system-production.up.railway.app/v1/vat/issue -d '{"human_identity":"test:probe@example.com:verified","agent_id":"probe-agent","resources":["test:resource"],"actions":["read"],"verification_method":"multi_modal","context":{"surface":"audit-probe"}}'
→ claims.vac_verification_method = "simulated"
→ claims.vac_trust_score = 0.3
→ claims.vac_context.client_claimed_method = "multi_modal"
→ claims.vac_context.vac_authorisation.assurance_basis = "none"
→ claims.vac_assurance_level = "L1"
```

Separately confirmed that `pharma-demo.html:398` (and the equivalent in the other four demo pages) sends a hard-coded `verification_method: 'multi_modal'` regardless of whether a real re-auth ceremony ran, and that `authorising_session_token` (sent by `pharma-demo.html:407` when a live ceremony session exists) has zero references anywhere in the local backend checkout's `main.py`/`vat_engine.py`/`session_auth.py` — i.e. even the session-token field the frontend sends isn't validated by the (stale) local code. Production behaves consistently with the dispatch's description regardless of the exact mechanism.

Fix: added a "Demo mode" banner when the root token's `verification_method` is `simulated`, plus the "assurance signal, not a permission" trust wording.

## Claim 4 — chain_hash tooltip overclaims coverage

**CONFIRMED.** `vat-verify.html:786`, tooltip text: *"A cryptographic fingerprint linking this token to its parent. Change anything and it breaks — so the chain is tamper-evident."*

Backend evidence — `vat_engine.py:307-317`:
```python
def compute_chain_hash(jti, parent_chain_hash=None):
    # Root:    SHA-256(jti)
    # Derived: SHA-256(parent_chain_hash + ":" + jti)
```
`chain_hash` is a function of `jti` (and the parent's chain_hash) only — it does not hash the scope, trust score, expiry, or any other claim. Changing e.g. the scope or trust score of a token does **not** change its chain_hash. The tooltip's "change anything and it breaks" is false; only changing the jti or breaking the parent link breaks it.

Fix: tooltip text replaced with the dispatch's wording: "Links this token to the one that delegated to it. It does not cover the token's contents; the signature does."

## Claim 5 — Revoke Chain button

**CONFIRMED (broken button) + PARTIALLY CONFIRMED (admin auth).** `vat-verify.html:740` calls `revokeChain('${rootJti}')`; `revokeChain` (line 907, now relocated) reads `` `${API}/v1/vat/revoke/${jti}` `` — `API` is never declared anywhere in the file (the declared constant is `API_BASE`), so every click throws a `ReferenceError` before the fetch fires.

The `jti` argument itself is also broken: `rootJti` is computed as `cd[0]?.jti || v.token_id || ''`. `chain_display` nodes (`vat_engine.py get_chain_for_display`, confirmed live via `GET /v1/vat/chain/{jti}`) carry `depth, agent_id, trust_score, scope_summary, verification_method, verification_label, verification_signals, is_root, status, label, icon` — **no `jti` field**. The verification object `v` (`GET /v1/vat/verify/{jti}` response) carries `valid, chain_length, root_human_ref, effective_trust_score, chain, errors, warnings, assurance_level, ...` — **no top-level `token_id` field either** (token_id only exists per-entry inside `v.chain[]`). So `rootJti` always evaluates to `''`; the button was calling `revoke('')` even before the `API` ReferenceError.

Admin-auth requirement — confirmed live:
```
$ curl -s -X POST https://vac-system-production.up.railway.app/v1/vat/revoke/vat_root_577ed3059119 -d '{"cascade":true}'
{"detail":"admin authentication required"}
```
The local backend checkout's `revoke_vat` handler (`main.py:1442-1454`) shows no auth check — this is the same staleness noted at the top of this doc; production enforces it, the local source doesn't yet reflect that.

Fix: Revoke Chain button removed from the public page; one line added noting revocation is an administrator action.

## Claim 6 — Modalities panel is a fixed policy label, not per-token results; geolocation not implemented; Speech Match mislabelled

**CONFIRMED.** `vat-verify.html:696-716`. The panel is driven by two things, neither of which is a per-token measurement:
1. `mp` = `data.modality_policy`, which `main.py`/`get_chain_for_display` sets from a **static** `MODALITY_POLICIES[RiskLevel.MEDIUM]` table (confirmed live: `GET /v1/vat/chain/{jti}` for a brand-new token returns `"modality_policy":{"label":"Standard","required":["video_liveness","voice_biometric","otp_verification"],"recommended":["geolocation"],...,"total_required":3,"total_available":6}` — identical fixed shape regardless of which checks, if any, actually ran for that token).
2. `active` = `modsForMethod(method)` (`vat-verify.html:529-538`), a **hard-coded client-side lookup table** keyed only on the coarse `verification_method` string, not on anything the backend reports per-check for this specific token.

`verification_signals` (the one field that could carry real per-check results, per node in `chain_display`) is present in the live API response but is an **empty array** for every method observed (`"verification_signals":[]`), confirming no per-check results are actually available to the page today.

Geolocation: `MODS.geolocation` (`vat-verify.html:526`) is labelled "Spatial verification" and rendered as an "on" green-pulsing indicator whenever `modsForMethod()` includes it (true for `multi_modal` and `multi_modal_plus_behavioural`) — i.e. for the vast majority of demo tokens. Grepping the local backend checkout for any geolocation capture/check logic (`grep -ri geoloc` across `vac-backend/`) returns nothing — there is no implementation to report a real geolocation check. Confirmed not implemented.

Speech Match: `MODS.voice_biometric` (`vat-verify.html:524`) is already labelled sub-text "Deepgram + lip sync" in the existing code, which is accurate (matches `main.py:1899-1903`'s `voiceprint`/`lip_sync` fallback keys) — the *label* "Speech Match" plus that sub-text is not materially misleading once the surrounding panel is honest about being a policy label rather than a completed check; no separate fix needed for the label text itself beyond folding it into the "not yet implemented" / "no per-check results" replacement.

Fix: replaced the modalities panel with the backend's actual per-check results when present (`verification_signals`, currently always empty) and the honest fallback string "This token does not carry per-check results" plus an explicit "Geolocation — not yet implemented" note when the panel would otherwise imply geolocation ran.

## Build summary

All six audit claims are CONFIRMED against the code this page actually talks to (live production backend); no claim was found absent, so all six build items (a)-(g) were implemented as specified. Local backend checkout staleness (noted above) does not weaken any of the six findings, since each was independently confirmed via direct production API calls.

## Build — what changed

`vat-verify.html`:
- (a) Hero badges no longer claim "Ed25519 signature valid" / "chain intact" / "checked the cryptographic signature live". They now say "Server status: active, not expired, not revoked" / "N node(s) · parent links present", matching exactly what `verify()` checks. A new "Signature check" card does the real work: if a compact JWT is available (URL fragment `#jwt=`, `sessionStorage`, or pasted into a textarea), it's verified client-side with WebCrypto Ed25519 (falling back to the pinned tweetnacl 1.0.3 UMD build from cdnjs when WebCrypto Ed25519 is unavailable) against `GET /v1/vat/key`, comparing `kid` first and refusing to check across a key rotation ("signed with an earlier key ... cannot be checked here") rather than reporting false/invalid.
- (b) Assurance level (`assurance_level` from `/v1/vat/verify`) is now shown with the plain-English L1/L2/L3 mapping from the dispatch.
- (c) A "Demo mode" banner appears whenever the root token's `verification_method` is `simulated`; the trust gloss now includes "an assurance signal, not a permission — the policy decides what level an action needs."
- (d) `chain_hash` tooltip now reads "Links this token to the one that delegated to it. It does not cover the token's contents; the signature does."
- (e) Revoke Chain button removed; replaced with a one-line note that revocation is an administrator action. The broken `revokeChain()` function (undefined `API` variable, always-empty `jti`) was deleted along with it.
- (f) The modalities panel no longer renders the fixed `modality_policy` label or the hard-coded `modsForMethod()` client lookup table as if they were per-token results. It now shows the backend's real per-token `verification_signals` when present, and otherwise the honest "This token does not carry per-check results" plus an explicit "Geolocation — not yet implemented" line.
- Plain-English glosses updated/added on jti, issued/expires, kid (new), trust, method, chain_hash per the dispatch's wording. `method` value itself is now rendered as `simulated (no live identity check)` rather than the bare enum string.

`pharma-demo.html`, `trusted-water-demo.html`, `financial-demo.html`, `tribunal-demo.html`, `clinical-demo.html`:
- Each now captures `compact_jwt` from the `/v1/vat/issue` response and appends it to the verify link as `#jwt=<compact_jwt>` (URL fragment only — never the query string, so the token never reaches a server).
- "Verify this seal independently" / "Verify this token independently — it is genuinely signed and live" copy changed to "Check it yourself" / "Check it yourself — the signature and status are verifiable, not asserted".

## Checks (headless Chromium, Google Chrome 152 via Playwright, executablePath override — no Playwright browser download available in this sandbox)

Ran an end-to-end script: loaded `pharma-demo.html` as a local file, clicked through all 5 steps (which mints a real token against the live production backend), extracted the verify link, and opened `vat-verify.html` with the real `#jwt=` fragment and `?jti=` (query-based jti lookup, since local file testing has no `/vat/verify/{jti}` path routing — `getJTI()` already supports this fallback).

- Signature check on the freshly-minted live token: **PASS** — `"Checked in your browser against the published key vac-key-9e8caa05: PASS"`.
- Demo mode banner: **shown** (root token's method was `simulated`, as Claim 3 predicts for a token issued without a server-verified re-auth session).
- Assurance line: **shown** — `"Assurance: L1 — no live identity check"`.
- Modalities panel: **honest fallback shown** — `"This token does not carry per-check results"` + `"Geolocation — not yet implemented."`.
- Revoke Chain button: **absent** (0 matches for a button with that text); one-line "administrator action" note present instead.
- chain_hash tooltip: confirmed exact new text via the rendered `title` attribute.
- Tamper test: flipped one character in the JWT payload segment, re-verified (via a full navigation, not a same-fragment nav) — signature check correctly reports **FAIL**.
- Paste-box fallback (no JWT available on the page): textarea + "Check signature" button verified against a hand-typed token and correctly reported **FAIL** (that particular test token's signature doesn't match).
- Horizontal overflow: **0px** at both 390px and 1280px viewports (`document.documentElement.scrollWidth - clientWidth`).
- Smoke-loaded `trusted-water-demo.html`, `financial-demo.html`, `tribunal-demo.html`, `clinical-demo.html` directly — zero JS `pageerror` events on any of them.
- All six `<script>`-containing files pass `node --check` on every extracted script block (no syntax errors introduced).

Screenshot at 390px (full end-to-end run against the live backend): `.context/verify-390.png`.

One methodology note for future runs: `document.body.textContent` in this app includes the raw source text of `<script>` tags (script content is still a DOM text node), so naive substring checks against `body.textContent` produce false positives/negatives (e.g. matching a JS comment that happens to contain "Revoke Chain", or missing a real "Assurance: L1" render underneath source text noise). The checks above use `#app`'s textContent (the actual rendered region) and/or element/attribute queries instead.
