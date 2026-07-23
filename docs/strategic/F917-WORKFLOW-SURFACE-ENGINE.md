# F-917 — Workflow Surface Engine (SPEC, not built)

**Status:** Spec only — primitive set v1 built today (hub-cards.js). General engine is future work.
**Cross-refs:** F-692 / F-686 (composition claim), L-2340 (everything is an L0 packet), L-2330 (no dead-ends), L-2351 (seal = transport), F-916 (WhatsApp seal rail)
**Last updated:** 23 Jul 2026

---

## The problem this solves

Every management page (dev-review-s144, decision-f755d-fix, Caroline's standards panel, Sam's tender tracker, Antonio's compliance dashboard) has been hand-assembled in HTML. Hand-assembled pages are a fresh chance to forget a learned rule on every page. The two S144 pages lost the L-2330 workflow contract (cards ended at a link — dead ends). F-917 Phase 1 fixes this structurally with a component library that cannot produce a dead-end card.

The general engine — described below — keeps the shape visible without building it now.

---

## The model

An **L0 packet** (L-2340) declares a WORKFLOW:

```json
{
  "workflow": {
    "id": "f755d",
    "states": ["DIAGNOSED", "APPROVED", "FIX_RUNNING", "VERIFIED", "MERGED"],
    "transitions": [
      { "from": "DIAGNOSED",    "to": "APPROVED",     "requires_human": true,  "seal": "whatsapp" },
      { "from": "APPROVED",     "to": "FIX_RUNNING",  "requires_human": false, "agent": "f755d-fix-lane" },
      { "from": "FIX_RUNNING",  "to": "VERIFIED",     "requires_human": true,  "seal": "browse" },
      { "from": "VERIFIED",     "to": "MERGED",       "requires_human": false, "agent": "merge-gate" }
    ],
    "evidence_per_state": {
      "DIAGNOSED": ["docs/debug/F755d-DIAGNOSIS.md"]
    }
  }
}
```

The **surface engine** reads this packet and composes the management UX from vetted primitives:

- Human-gate transitions → `decisionCard` with the correct `seal_transport`
- Evidence states → `reviewCard` with evidence_links populated from the packet's artifact list
- Agent-only transitions → status cards (no human action, no dead-end possible)

Dead-ends and missing transports are impossible by construction: the component layer throws at render time if the packet omits a required field, and the packet schema rejects transitions with `requires_human: true` but no `seal`.

---

## Primitive set v1 (built today — F-917 Phase 1)

`p/components/hub-cards.js` provides:

| Component | Enforces |
|-----------|----------|
| `reviewCard({…, evidence_links, next_action})` | L-2330: throws if `next_action` absent |
| `decisionCard({…, seal_transport})` | L-2351: throws if `seal_transport` absent; WhatsApp link or chat phrase, never local state |

These two components are the full primitive set for today. They are sufficient to compose any human-in-the-loop management surface where the human's action is either "read and proceed" (review) or "approve/hold" (decision).

---

## Instance surfaces (not built — illustrative)

| Surface | L0 packet type | Human transitions | Seal transport |
|---------|---------------|-------------------|----------------|
| Dev feature review (built today) | feature packet | code review → merge approval | WhatsApp |
| Legal matter (Caroline) | legal-matter packet | brief review → instruct → sign-off | WhatsApp |
| Tender (Sam) | tender packet | scope review → bid/no-bid | WhatsApp |
| Compliance (Antonio) | compliance-item packet | gap review → remediation approval | WhatsApp |

Each instance needs only: (a) a packet that declares its workflow, and (b) a surface engine call that maps states → components. The components themselves are shared and already enforce the contracts.

---

## What is NOT built (general engine scope)

The general engine — the part that reads a packet's `workflow` declaration and auto-composes the page — is not built. Building it requires:

1. A canonical packet schema with a `workflow` field (extends L-2340)
2. A renderer that maps workflow states to component calls
3. A packet loader that fetches current state from the Athena API
4. A state-transition dispatcher (the seal transport fires an API call, not just a WhatsApp message)

This is F-910 territory. The component library built today is the primitive layer that F-910's renderer will call. The shape is locked; only the automation is deferred.

---

## Why this ordering is correct

- **F-917 Phase 1 (today):** Component library with enforced contracts. Pages composed manually but safely.
- **F-916:** WhatsApp seal rail — the transport layer the components already reference.
- **Task 308:** Reply-recorder — makes WhatsApp seals durable (today they're real transport; tomorrow they're receipts).
- **F-910:** Auto-generated surface — reads packets, composes pages, no hand-assembly.

Each phase produces something Rob can use today, not just a stepping stone.
