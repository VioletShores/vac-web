# Lane Notes — task-667 · PKT-S156 Lane B

**Task:** PKT-S156-MATTEO-ONEPAGER-CONTENT-OVERHAUL — Lane B  
**Branch:** task-667-content-blocks → merged to main @ 6e33f42  
**Executed:** 2026-08-08 · **Verified:** 2026-09-01  
**Gate 1:** PASSED by Rob S181  

---

## Live Patent Count (read 2026-09-01)

Source: https://vacprotocol.org/#ip

| Metric | Value |
|--------|-------|
| Patent claims | **1,068** |
| Filings (homepage counter) | 16 |
| Filings (page text) | 17 |

**Note:** vacprotocol.org/#ip has an internal inconsistency — the summary counter shows 16 filings but the Extended Capabilities section text reads "1,068 patent claims across 17 filings". The audit identified portfolio.html as the canonical source (9 VAC + 8 Athena = 17 total). The v2 one-pager cites the claim count (1,068) only, not the filing count, so it is unaffected. The stale "16 filings" on the homepage counter is a separate residual fix.

---

## What was built

### content/blocks/ library (10 blocks + INDEX.md)

| Block | File | Description |
|-------|------|-------------|
| vision | vision.md | Core VAC vision — verified human root, proportional assurance, signed receipts |
| wedge | wedge.md | Market wedge — accountability + EU AI Act retrofit as the entry point |
| icp | icp.md | F-1056 canonical ICP paragraph — legal/tribunal, water/critical-infra, defence-adjacent |
| architecture-l1 | architecture-l1.md | 6-step honest-status flow (BUILT·LIVE / BUILT·MERGING / PLANNED) |
| architecture-l2 | architecture-l2.md | L2 component block diagram — Lane D forward pointer |
| privacy-ladder | privacy-ladder.md | F-1055 three-layer privacy architecture |
| gtm | gtm.md | GTM sequence — design-partner pilots, funding stack, layered end-state |
| papers | papers.md | IETF Internet-Drafts — canonical datatracker links |
| portfolio | portfolio.md | 1,068 claims / 17 filings — canonical count and used-by rule |
| sdk-story | sdk-story.md | Honest API/SDK story — what ships vs what's designed |

### Matteo one-pager v2

URL: https://vacprotocol.org/p/matteo-v2-b8d2f4c1e39a.html  
Assembled from content/blocks/. Leads with ACCOUNTABILITY. Includes:
- EU AI Act enforcement wedge (Article 50 / 2 Aug 2026)
- F-1056 ICP paragraph (legal/tribunal, water/critical-infra, defence-adjacent)
- F-1055 privacy ladder (3 layers: in-session zero-retention → Postgres RLS → sovereign/air-gapped)
- Architecture L1 (6-step honest-status: BUILT·LIVE / BUILT·MERGING / PLANNED)
- IETF papers with canonical datatracker links (audit §7#6 fix)
- Build-stamp footer: "BUILT FROM BLOCKS · 2026-08-08 · CONTENT/BLOCKS/ v1 · ONE-PAGER V2"

### Audit P1/P2/P3 fixes applied

| Finding | Fix | Status |
|---------|-----|--------|
| P1#1: Patent count 1,028+ → 1,068/17 | Updated architecture, sdk, developers, vat-verify, index, keyvault, auth, and all pages | ✓ |
| P1#2: "DEVELOPER SDK" mislabel | Renamed to "DEVELOPER API" / "VAC REST API" | ✓ |
| P2#4: index.html whitepaper vintage | Added "March 2026" note on download link | ✓ |
| P2#5+7: scoring.html "certified" | Changed to "third-party tested / independently validated" | ✓ |
| P2#8: developers.html aiinternet.ai 307 | Updated to www.aiinternet.ai | ✓ |
| P3#9: Build-stamp footers | Added to architecture.html, developers.html, sdk.html, scoring.html | ✓ |

---

## Link-check results (verified 2026-09-01)

**Crawl target:** https://vacprotocol.org/p/matteo-v2-b8d2f4c1e39a.html

### Depth-1 (7 links)

| HTTP | URL |
|------|-----|
| 200 | https://vacprotocol.org/origin.html |
| 200 | https://vacprotocol.org/financial-demo |
| 200 | https://vacprotocol.org/signalrank.html |
| 200 | https://vacprotocol.org/architecture.html |
| 200 | https://vacprotocol.org/portfolio.html |
| 200 | https://datatracker.ietf.org/doc/draft-zagarella-verified-human-root/ |
| 200 | https://datatracker.ietf.org/doc/draft-zagarella-autonomy-governor/ |

### Depth-2 (9 links checked)

| HTTP | URL |
|------|-----|
| 200 | https://vacprotocol.org/tribunal-demo.html |
| 200 | https://vacprotocol.org/org-config.html |
| 200 | https://vacprotocol.org/eu-ai-act.html |
| 200 | https://vacprotocol.org/ |
| 200 | https://vacprotocol.org/vat-verify |
| 200 | https://vacprotocol.org/scoring |
| 200 | https://vacprotocol.org/org-onboard.html |
| 200 | https://vacprotocol.org/org-console.html |
| 200 | https://vacprotocol.org/developers.html |

**Dead links at depth-2: 0**

---

## Visual QA

Browse pass on 2026-09-01:
- Dark background (#0A0F1A) shell renders correctly ✓
- Gold anchors (#C9A227) — all links render amber, no default-blue ✓
- Accountability headline leads ✓
- Privacy ladder three-layer card present ✓
- Architecture cards with BUILT·LIVE / BUILT·MERGING badges ✓
- Build-stamp footer visible ✓
- Page loads 200 in headless browse ✓
- No JS errors in console ✓

---

## Claim verification

| Claim | v2 page text | Posture rule | Verdict |
|-------|-------------|-------------|---------|
| Patent claim count | "1,068 patent claims, receipt-verified" | live-fetched 2026-09-01: 1,068 ✓ | PASS |
| "in production" | "The system is in production — live backend, hundreds of sealed verifications" | production-ok (architecture.html confirms BUILT·LIVE) | PASS |
| SDK / API | Not claimed in v2; architecture section describes protocol engines | SDK story: REST API + widget only; no npm/pip claim | PASS |
| Privacy ladder | "SOC 2 Type II and GDPR Article 25 are planned for Q4 2026 — not claimed today" | Explicit caveat present | PASS |
| IETF papers | Uses datatracker canonical links | Audit §7#6 fixed: self-hosted → datatracker | PASS |
| "certified" | Not used in v2 | never-certified posture | PASS |

---

## Pending lanes

- **Lane C:** privacy page (F-1055) + ICP wiring
- **Lane D:** whitepaper refresh + architecture.html L2 (hub block diagram promotion)
- **Lane E:** aiinternet.ai sweep from same blocks
- **Gate 2:** Rob reads v2 end-to-end on phone → sends to Matteo

---

*Written by Athena (session 31) · PKT-S156 Lane B · 2026-09-01*
