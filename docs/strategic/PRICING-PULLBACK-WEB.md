# Pricing Pullback — Web

**Date:** 2026-06-24
**Branch:** `Schemo512/pricing-pullback-web`

## Why

VAC has not launched pricing publicly. Public price tables (a `$0/mo` Starter, a
`$0.10/verification` Growth tier, an "Enterprise / Custom" tier) mis-frame the
product: VAC is sovereign trust infrastructure deployed via partnership with a
small number of design partners — not a self-serve `$49/mo` SaaS. This change
removes all public pricing tables and dollar figures from VAC's own pricing
displays and repositions every related call-to-action to early-access /
design-partner messaging.

## Standard replacement copy

**Pricing-table replacement (general pages)**
- Headline: `Pricing is set per engagement during early access.`
- Body: `VAC is being deployed with a small number of partners across legal, finance, and critical infrastructure. Pricing and plans will open as we expand — for now, let's talk about your use case.`
- Button: `Start a conversation` → `mailto:hello@vacprotocol.org`

**Developer / API signup replacement (developer pages)**
- Headline: `VAC is in early access.`
- Body: `We're working directly with our first design partners to integrate verifiable human authority. Tell us what you're building and we'll get you set up.`
- Button: `Request access` → `mailto:developers@vacprotocol.org`

Both reuse the existing dark Athena/VAC theme classes (`.signup-form`,
`.price-card`, `.section-title`, `.section-label`, `.btn`/`.btn-primary`). No
emoji. The site's existing contact mechanism is `mailto:` — `hello@vacprotocol.org`
for general contact, `developers@vacprotocol.org` for the developer page.

---

## Pages changed

### `developers.html` (developer / API page)
This page had **both** a pricing table and a "Get your API key" signup form.

- **Nav link** `Get API Key` → relabelled `Request access` (still anchors `#signup`).
- **Hero CTA** `Get Free API Key` → relabelled `Request access` (removed the "Free" framing; still anchors `#signup`).
- **Pricing section (`#pricing`)** — REMOVED the pricing table:
  - "Free while we build" / "grandfathered when paid tiers launch" copy.
  - `EARLY ACCESS` card: `$0` / "during development" + `Get Started` CTA.
  - `ENTERPRISE` card: `Custom` / "when you need SLAs" + `Contact` CTA.
  - REPLACED with the **pricing-table replacement** panel (`Start a conversation` → `hello@vacprotocol.org`). Section `id="pricing"` retained so the nav anchor still works.
- **Signup section (`#signup`)** — REMOVED the "Get Your API Key" form ("Free during development", email + company inputs, `Create Account & Get Key` button) and REPLACED with the **developer signup replacement** panel (`Request access` → `developers@vacprotocol.org`). Section `id="signup"` retained.
- Orphaned `signup()` JS and `.price-*` / `.pricing` CSS rules left in place (no longer referenced, not user-visible).

### `landing.html` (general marketing page)
- **Pricing section (`#pricing`)** — REMOVED the three-tier pricing grid:
  - `Starter`: `$0/mo` — "100 verifications/month included".
  - `Growth` (featured): `$0.10/verification` — "After 100 free tier".
  - `Enterprise`: `Custom` — "Volume pricing + SLA".
  - "Pay per verification. / Start free." section title.
  - REPLACED with the **pricing-table replacement** panel (`Start a conversation` → `hello@vacprotocol.org`). Section `id="pricing"` retained for the nav anchor.
- **Bottom CTA** — `Get your API key →` (a dead `href="#"` self-serve link) repointed to `mailto:hello@vacprotocol.org` and relabelled `Start a conversation`. Surrounding feature copy ("Three lines of code. Four modalities. One trust score…") kept.
- Orphaned `.pricing-grid` / `.price-amount` CSS rules left in place; `.price-card` is reused by the new panel.

---

## Pages reviewed — no VAC pricing display found (intentionally unchanged)

The brief listed these as mentioning "pricing/tiers/dollar amounts." On
inspection, the dollar figures in each are **demo / capability content**, not
VAC's own price list. Per the brief ("keep all feature descriptions and
capability copy — only remove the dollar figures and pricing framing"), they
were left intact. None contains a VAC pricing table, tier card, or self-serve
signup CTA.

| Page | Dollar content found | Verdict |
|---|---|---|
| `compare.html` | `$0` live query-cost stat (`#statCost`, hidden until a comparison runs) | Demo stat — keep |
| `launch-demo.html` | Agent spending demo ($2.40 / $8.20 of $200 ceiling); trust-graph unit-economics narrative | Capability demo — keep |
| `apikeys.html` | "BYO API Keys" vault; OpenAI/xAI provider labels only | No VAC pricing/signup — keep |
| `agents.html` | Agent authority spend ceilings ($0.08–$0.75); `#statSpend` live stat | Core-feature demo (scoped spend) — keep |
| `auth.html` | Only false positives (`/modality-requirements` fetch, code comments) | No pricing — keep |
| `control-demo.html` | Product-recommendation demo prices ($24/mo, $9.99/mo, $79/mo for fictional products) | Demo scenario — keep |
| `msg.html` | Only a false positive (`/modality-requirements` URL) | No pricing — keep |
| `athena-regatta-club-copilot.html` | Restaurant-copilot demo: supplier costs, a `$49/month "Bay Run Club"` membership idea the AI suggests **for the restaurant** | Demo intelligence — keep |
| `sdk.html` | No dollar figures; only CTA is "Explore the API →" (docs link, not signup) | Nothing to reposition — keep |

> Note: the only `$49` left in the repo (`athena-regatta-club-copilot.html`) is a
> restaurant membership idea generated inside a copilot demo — it was never a VAC
> SaaS tier.

---

## Verification

Repo-wide grep after the change confirms **no VAC pricing display** remains:

- No `price-card` / `pricing-grid` / `price-amount` markup is rendered as a price tier (the surviving `.price-card` instance is the early-access panel on `landing.html`; the leftover CSS rules are invisible).
- No `$49`, `/mo`, `per month`, `$0.10/verification`, `price_usd`, or `monthly_verifications` appears in any visible VAC pricing context.
- Remaining `$` figures are all demo/feature/live-stat content (table above).

Repro:

```sh
grep -rnE '\$49|>\$0<|\$[0-9].*/mo\b|per month|price_usd|monthly_verifications|price-amount|pricing-grid' --include='*.html' .
```
