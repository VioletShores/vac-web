---
block: sdk-story
description: Honest SDK/API story — what ships vs what's designed
used-by: sdk.html, developers.html
updated: 2026-08-08
---

# Developer API — Honest Story

## What ships today

**REST API (live)** — `https://vac-system-production.up.railway.app` — fully live, adversarially reviewed. Endpoints: verify a human, issue a VAC token, gate an action, write an AAR, verify a receipt. Confirmed at /v1/vat/assurance-levels.

**VACVerify.js drop-in widget (shipped)** — `<script src="https://vacprotocol.org/vac-verify.js">` + `VACVerify.init()` / `VACVerify.open()`. A genuine one-line integration for the verification ceremony UI. The JS file is live at that URL.

**Design-partner preview** — early access; production-ready for pilots; not generally available yet.

## What is designed but not released

**F-097 / Cloud-VAT SDK Track C** — one-line drop-in packaged SDK (npm / pip). Designed. Not released. No `@vacprotocol/sdk` npm package exists today. The `require('./vac-middleware')` snippet in the developer docs is a local file pattern, not a published dependency. A developer looking for `npm install @vacprotocol/sdk` will not find it.

Honest headline: **"DEVELOPER API"** — not "DEVELOPER SDK". The API is real, REST-based, and live. The packaged SDK is the next milestone.

## Language rules
- Call the shipped thing "DEVELOPER API" or "VAC REST API"
- The widget is a "Drop-in verification widget" (accurate)
- Framework snippets should be labelled "example pattern" not "install"
- Do not imply a published npm/pip package exists
- Do say: "design-partner preview" / "early access" (honest posture)
