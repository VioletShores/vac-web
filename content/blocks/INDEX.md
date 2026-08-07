# Content Block Library — INDEX

**Source:** `content/blocks/` — single-source content library for vacprotocol.org
**Principle:** one block per claim; a claim appearing outside its block is a drift flag
**Updated:** 2026-08-08 · **Packet:** PKT-S156-MATTEO-ONEPAGER-CONTENT-OVERHAUL · **Lane B**

---

## Blocks

| Block | File | Used By | Description |
|-------|------|---------|-------------|
| vision | [vision.md](vision.md) | p/matteo-v2-*, index.html, architecture.html, origin.html | Core VAC vision — verified human root, proportional assurance, signed receipts |
| wedge | [wedge.md](wedge.md) | p/matteo-v2-*, index.html, eu-ai-act.html | Market wedge — accountability + EU AI Act retrofit |
| icp | [icp.md](icp.md) | p/matteo-v2-*, index.html | F-1056 canonical ICP paragraph — target sectors and entry sequence |
| architecture-l1 | [architecture-l1.md](architecture-l1.md) | p/matteo-v2-*, architecture.html | 6-step honest-status flow (BUILT·LIVE / BUILT·MERGING / PLANNED) |
| architecture-l2 | [architecture-l2.md](architecture-l2.md) | architecture.html (Lane D) | L2 component block diagram — Lane D forward pointer |
| privacy-ladder | [privacy-ladder.md](privacy-ladder.md) | p/matteo-v2-*, privacy.html (pending Lane C) | F-1055 three-layer privacy architecture |
| gtm | [gtm.md](gtm.md) | p/matteo-v2-* | GTM sequence — design-partner pilots, funding stack, layered end-state |
| papers | [papers.md](papers.md) | p/matteo-v2-*, portfolio.html | IETF Internet-Drafts — canonical datatracker links |
| portfolio | [portfolio.md](portfolio.md) | p/matteo-v2-*, portfolio.html, all footer references | 1,068 claims / 17 filings — canonical count and used-by rule |
| sdk-story | [sdk-story.md](sdk-story.md) | sdk.html, developers.html | Honest API/SDK story — what ships vs what's designed |

---

## Drift Rules

- **portfolio count rule**: "1,068 claims across 17 filings" — portfolio.html is authoritative. Any page with a different number is stale. Run `grep -r "patent" --include="*.html" .` to find candidates.
- **IETF link rule**: use IETF Datatracker URLs in all external-facing pages (papers block has both; datatracker is canonical).
- **SDK language rule**: "DEVELOPER API" not "DEVELOPER SDK"; no claim of npm/pip package.
- **certified language rule**: use "independently validated" or "third-party tested", not "certified", for sub-component claims (scoring.html).
- **build-stamp rule**: every page assembled from blocks should carry a footer date stamp.

---

## Assembly pattern

Pages are assembled from blocks by reference. The blocks are NOT embedded inline — they are the source of truth. When a page is rebuilt, pull from the block, not from another page. The one-pager v2 (`p/matteo-v2-*.html`) is the reference assembly.

Future audiences receive the same blocks, assembled per their context:
- Matteo (now): one-pager v2, engineer-to-engineer register
- Catania professor: same one-pager v2 + funding-stack context
- Caroline: emphasis on legal/tribunal ICP + architecture L1
- Antonio / AQP: emphasis on critical infrastructure ICP + privacy ladder
- aiinternet.ai visitors: wedge + ICP + papers (shorter form)
