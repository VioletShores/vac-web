# IP Page Reconcile — 2026-08-02

Report only. No page content changed except on a throwaway branch, prepared but NOT merged. Nothing here is invented — every figure below is quoted from a live page fetch, a repo file at a specific commit, or `FILING-REGISTER.md`. Where I could not verify a number against either source, it's marked UNKNOWN and needs Rob to confirm before anything ships.

## 0. Repo provenance correction (read this first)

The task named the site repo as the one to branch from for the page edit. I initially branched `Schemo512/vacprotocol.org` (matches the domain name) — but its `main` still shows the OLD IP section (285 claims / 6 filings) and **has never contained** the live site's "1028+" figures anywhere in its git history (`git log --all -S"1028" -- index.html` = empty). That repo is a stale/orphaned clone, not the deploy source.

The actual production source is **`VioletShores/vac-web`** — its `index.html` matches the live `vacprotocol.org` HTML byte-for-byte on the numbers checked, and its history has the commit that introduced the current figures (`876a55b`, 2 May 2026). I redid the branch there.

**Branches pushed (both empty diffs from main, just checkpoints — see §4 for the prepared-not-merged edit):**
- `Schemo512/vacprotocol.org#task-495-ip-reconcile` — wrong repo, pushed before I found the mismatch, harmless, can be deleted
- `VioletShores/vac-web#task-495-ip-reconcile` — correct repo, this is where the prepared edit in §4 lives

**Flag for Rob:** two repos both plausibly named "the VAC site repo" exist, only one is live. Worth deleting or archiving `Schemo512/vacprotocol.org` so this doesn't cost someone else an hour again.

## 1. Live page — every claim/filing/date figure found in the `#ip` section and surrounding hero/summary text

Fetched directly from `https://vacprotocol.org` (browser render + raw HTML, checked 2026-08-02):

| Location | Text |
|---|---|
| Hero stat | **1028+** "Patent claims filed" |
| Hero stat | **16** "IP filings" |
| Hero stat | **7** "Biometric modalities" |
| Meta/OG/Twitter description | "1028+ patent claims across 16 filings" |
| Extended Capabilities intro | "1028+ patent claims across 16 filings — VAC Protocol (445 claims) and sibling Violet Shores filings (583 claims)" |
| IP section H2 | "1028+ claims across sixteen filings" |
| IP section, itemized row 1 | Provisional Patent — 21 Feb 2026 — AU 2026901425 — Claims 1–112 |
| IP section, itemized row 2 | Supplementary #1 — 22 Feb 2026 — AU 2026901428 — Claims 113–134 |
| IP section, itemized row 3 | Supplementary #2 — **24 Feb 2026** — AU 2026901474 — Claims 135–167 |
| IP section, itemized row 4 | Supplementary #3 — 26 Feb 2026 — AU 2026901553 — Claims 168–241 |
| IP section, itemized row 5 | Supplementary #4 — 27 Feb 2026 — AU 2026901601 — Claims 242–271 |
| IP section, itemized row 6 | Supplementary #5 — 27 Feb 2026 — AU 2026901604 — Claims 272–285 |
| IP section, Total Portfolio row | "Combined Violet Shores portfolio: 1028+ claims across 16 filings. VAC Protocol accounts for 445 claims across 8 filings... The remaining 583 claims across 8 filings belong to sibling products." |
| Architecture / Layer 1 (Identity) | "facial geometry, voice pattern, behavioural biometrics, and device-contextual signals" — 4 named modalities |

The itemized list has **6 rows** and its own claim ranges only sum to **285 claims**, but the Total Portfolio row two paragraphs below it asserts VAC alone is **445 claims across 8 filings**. Those two statements are on the same page and contradict each other's arithmetic.

## 2. Register says (`VioletShores/vac-protocol`, `patent/FILING-REGISTER.md`, read in full)

The register itself has two different "current" totals — I'm treating the one explicitly dated as the update as authoritative:

**Authoritative (§"Complete Filing Portfolio — Updated 30 April 2026", lines 317–329):**

| # | Filing | Application | Date | Claims | 
|---|--------|-------------|------|--------|
| 1 | Original | AU 2026901425 | 21 Feb 2026 | 1–112 (112) |
| 2 | Supp #1 | AU 2026901428 | 22 Feb 2026 | 113–134 (22) |
| 3 | Supp #2 | AU 2026901474 | **24 Feb 2026** | 135–167 (33) |
| 4 | Supp #3 | AU 2026901553 | 26 Feb 2026 | 168–241 (74) |
| 5 | Supp #4 | AU 2026901601 | 27 Feb 2026 | 242–271 (30) |
| 6 | Supp #5 | AU 2026901604 | 27 Feb 2026 | 272–285 (14) |
| 7 | **Supp #6** | **AU 2026901975** | **10 Mar 2026** | **286–316 (31)** |
| 8 | **Supp #7 (Mega)** | **AU 2026904139** | **30 Apr 2026** | **317–445 (129)** |
| | **VAC TOTAL** | | | **445 claims, 8 filings, AUD $800** |

**Stale (§"Combined Violet Shores IP Portfolio", lines 336–341, not updated after the Mega filing was added above it):**
> VAC Protocol: 316 claims, 7 filings, AUD $700 · Athena/SignalRank: 242 claims, 5 filings, AUD $500 · TOTAL: 558 claims, 12 filings, AUD $1,200

`CLAUDE.md` in `vac-protocol` still quotes "316 claims across 7 filings" — same stale figure as the register's un-updated bottom table. Three sources, three ages of the same number.

**Internal register conflict on Supp #2's date:** the detailed record (lines 73–77) states filing date **23 February 2026**, submission timestamp "23/02/2026 11:31 PM AEST." The summary table (line 323) states **24 February 2026** for the same application number 2026901474. The live page follows the summary table's 24 Feb — but the detailed record with the actual submission timestamp looks more authoritative. Unresolved without Rob checking the IP Australia lodgement receipt.

**Post-30-April material checked, confirmed NOT filed** (per explicit "NOT yet filed" / "DISCLOSURE DRAFT" language in the docs themselves, and cross-referenced against the register — no entry exists):
- `patent/SUPPLEMENTARY-8-HAND-FACE-COLOCATION-DRAFT.md` (drafted 21 Jun 2026) — hand-face spatial co-location, candidate VAC Supp #8
- `patent/ATTORNEY-PACKAGE-HAND-FACE-COLOCATION-2026-06-21.md`, `patent/CANDIDATE-COMPOUND-BINDING-CLAIMS-2026-06-20.md` — supporting drafts for the same unfiled Supp #8
- The "Action Hash / Agent Drift" material (candidate claims ~369–388) is explicitly flagged in the Supp #8 draft itself as "does NOT appear filed in FILING-REGISTER"

None of this belongs on the page yet — correctly absent from both the register's filed total and the live page.

## 3. Discrepancy table

| # | Item | Page says | Register says | Verdict | Action needed |
|---|------|-----------|----------------|---------|----------------|
| 1 | VAC claims/filings (Total Portfolio row) | 445 claims / 8 filings | 445 claims / 8 filings (30 Apr update) | **MATCH** | None |
| 2 | VAC itemized filing list | 6 rows, sums to 285 claims | 8 filings on record (Supp #6 AU2026901975 10 Mar, Supp #7/Mega AU2026904139 30 Apr, +160 claims) | **DISCREPANCY — page incomplete** | Add 2 rows (drafted in §4, not merged) |
| 3 | Athena/sibling portfolio | 583 claims / 8 filings | Register only documents Athena at 242 claims / 5 filings (stale); no register source for 583/8 anywhere in `vac-protocol` | **UNKNOWN — unverified** | Rob to confirm from Athena's own filing register before this number is trusted anywhere |
| 4 | Combined total | 1028+ claims / 16 filings | Not derivable — depends entirely on unverified #3 | **UNKNOWN, downstream of #3** | Same as #3 |
| 5 | Supp #2 filing date | 24 Feb 2026 | Register self-conflicts: detail record says 23 Feb 2026 (has a timestamp), summary table says 24 Feb 2026 | **UNKNOWN — register internally inconsistent** | Rob to check IP Australia receipt for AU2026901474, fix whichever register entry is wrong |
| 6 | Biometric modality count (hero stat) | "7 Biometric modalities" | N/A — not a filing fact, but the same page's Architecture section names exactly 4 ("facial geometry, voice pattern, behavioural biometrics, device-contextual signals") | **DISCREPANCY — page self-inconsistent** | Rob to confirm whether it's 4, 7, or something else; not a register question |
| 7 | Repo provenance | `Schemo512/vacprotocol.org` main has never matched production | N/A | **PROCESS RISK** | Consider archiving the dead repo |

No new-number invention anywhere above — #2's fix (§4) only adds rows using application numbers, dates, and claim ranges already stated verbatim in the register.

## 4. Prepared (NOT merged) page edit

Branch: `VioletShores/vac-web#task-495-ip-reconcile`. Only item #2 gets a drafted fix — everything else (#3, #4, #5, #6) needs Rob's confirmation of a real number first, and I was told never to invent one.

Draft adds two `.ip-row` entries to the `#ip` section of `index.html`, sourced verbatim from `FILING-REGISTER.md`:

```html
<div class="ip-row">
  <div class="ip-row-filing">Supplementary #6</div>
  <div class="ip-row-date">10 Mar 2026</div>
  <div class="ip-row-detail">AU 2026901975 &mdash; Claims 286&ndash;316. Standardised action attestation records and execution graph formation, workflow-level provenance correlation identifier, agent reputation scoring from execution history, automatic provenance emission for agent frameworks.</div>
</div>
<div class="ip-row">
  <div class="ip-row-filing">Supplementary #7 (Mega)</div>
  <div class="ip-row-date">30 Apr 2026</div>
  <div class="ip-row-detail">AU 2026904139 &mdash; Claims 317&ndash;445. 129 claims across 18 sections extending the multi-modal biometric verification base.</div>
</div>
```

This is drafted in my working tree on that branch, **not committed**. The Supp #7 (Mega) description is intentionally generic — the register's own entry for it (line 308) just says "129 new claims across 18 sections" without naming them individually, so I didn't editorialize a more specific description that isn't in the source. If Rob wants the same level of topic detail as the other rows, someone needs to pull the actual section titles from `patent/VAC-SUPPLEMENTARY-7-MEGA-FILING-READY.md` or the filed PDF.

**Do not merge until Rob confirms:**
1. The two new rows are correct/wanted (straightforward — this is items already in the register with no ambiguity)
2. Whether #3/#4 (Athena 583/8, combined 1028+/16) should be corrected, left as-is pending real Athena register data, or pulled from the page until verified
3. Which date is right for Supp #2 (#5)
4. What the real modality count is (#6)

If Rob only confirms #2, that alone is safe to merge — it fixes a page that currently contradicts itself (6 itemized rows vs. an aggregate total claiming 8), without touching any number that lacks a register source.
