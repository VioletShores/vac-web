# Private VAC original capture bridge

Candidate,18November2026; companion Athena and VAC-protocol capture flags OFF.
The bridge is inactive for ordinary `/auth`, Vault, critic, Decisions and
narration handoffs. It implements the owner's scripted self-service recording
flow from Athena's **Record my VAC walkthrough** navigation entry.

Dedicated URL: `/auth?handoff=vac-walkthrough-record&state=<43-character state>`.
Only those query keys are allowed. The bridge requires the exact
`https://api.athenapilot.ai` opener, matching state, first notice and unexpired
session. It exposes no camera-ready path until the owner clicks Continue.
`requestCamera` refuses a missing/unready bridge for this dedicated URL.

The FULL challenge copies only the validated `walkthrough_state_sha256` field;
name/risk/profile inputs retain their existing semantics. Fixed timeline labels
contain no actual words, digits, identity or secrets. Successful normal result
rendering completes before the bridge sees the existing original Blob. A
separate checkbox/click approves private save. The bridge creates no recorder,
provider request, VAT, action grant or public media URL.

Only the exact origin, opener and state may acknowledge the bounded chunk
transfer. Begin/chunk ACKs cannot claim a completed save. Only the distinct
`vac-walkthrough-saved` message resolves final completion, after Athena's
durable byte readback. Retries retain progress of the same original. Clip and
receipt references are cleared on completion/decline/expiry/page exit; the
ordinary `vac_verified` session copy omits only `walkthrough_receipt`.

The default Vault handoff exits before defining its object for this film kind.
The usual “Continue to the matters” destination is omitted in the dedicated
film flow; the private result offers Return to Athena. All speech-repair bytes
from main5937595a are preserved apart from the separately reviewed film hooks.

`tests/walkthrough-capture.test.js` uses only synthetic Blobs and a VM message
harness. It tests ordinary-auth inertia, origin/source/state/consent boundaries,
exact transfer, final-ACK type, three lost-final-ACK timeouts plus user retry,
expiry, session persistence omission and strict FULL body/camera guards. The
existing handoff CI workflow explicitly selects it. This is not a physical
camera/iPad or live end-to-end acceptance result.
