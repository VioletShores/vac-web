# S117 — D-OTP-INPUT-NO-DASH-MISMATCH

**Status:** Fixed, live on https://vacprotocol.org
**Commit:** `211a5c3`
**Scope:** Pure frontend. No backend change.
**For Rob review.**

## The mismatch

The OTP verification email formats the code as `000-000` (a dash after the third
digit, produced by the backend `_format_otp` helper). But the OTP input field in the
UI showed no dash:

- `placeholder="000000"` — six digits, no separator
- `maxlength="6"` — no room for a dash
- No formatting as the user types

So a user reading `481-203` from their email landed on a field that looked like
`000000` and had to mentally strip the dash. Small friction, but it is the exact
moment we are asking them to trust the flow. The display should mirror the email.

## The fix

Make the input mirror the emailed `000-000` layout, while still sending the backend
6 raw digits.

1. **Placeholder** → `000-000`
2. **Auto-insert the dash** as the user types: strip non-digits, cap at 6 digits,
   insert `-` after the third digit.
3. **Strip the dash before submit** so the backend receives 6 raw digits and the
   `length === 6` guard still holds.
4. **maxlength** → `7` to fit the dash.
5. Kept the mono font, centering, and letter-spacing untouched.

### auth.html

`#otpInput` (line ~401):

```html
<!-- before -->
<input ... maxlength="6" placeholder="000000" ... onkeydown="...">

<!-- after -->
<input ... maxlength="7" placeholder="000-000" ... oninput="formatOTPInput(this)" onkeydown="...">
```

New formatter + strip-before-submit in `verifyAuthOTP()` (line ~1259):

```js
function formatOTPInput(el) {
    let digits = el.value.replace(/\D/g, '').slice(0, 6);
    el.value = digits.length > 3 ? digits.slice(0, 3) + '-' + digits.slice(3) : digits;
}

function verifyAuthOTP() {
    // Strip the display dash so the backend receives 6 raw digits.
    const code = document.getElementById('otpInput').value.replace(/\D/g, '');
    ...
}
```

### verify.html

Same treatment on `#otp-code`. The existing `input` listener already stripped
non-digits and auto-submitted at 6 chars; it now inserts the dash too and gates the
auto-submit on the stripped digit count (not the dashed display value):

```js
otpInput.addEventListener('input', (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
    e.target.value = digits.length > 3 ? digits.slice(0, 3) + '-' + digits.slice(3) : digits;
    if (digits.length === 6) verifyOTP();
});
```

And `verifyOTP()` strips the dash before the length check / fetch, same as auth.html.

### vat-verify.html — not applicable

`vat-verify.html` uses six separate single-digit boxes (`.otp-digit`,
`maxlength="1"` each), not one combined input. A single-input dash treatment does
not apply there — each box holds one digit and there is no place for a separator.
No "copilot" page has an OTP input. So the fix lands on auth.html and verify.html only.

## Why this is safe

- The dash is display-only. Every read path that talks to the backend
  (`verifyAuthOTP`, `verifyOTP`) calls `.replace(/\D/g, '')`, so the payload is always
  6 raw digits. The `code.length !== 6` guard operates on the stripped value, so it
  is unchanged in behavior.
- Backspace, paste, and mid-string edits all reconstruct the value from raw digits,
  so the field can never hold a malformed `12-3` or a stray double dash.
- `maxlength="7"` caps input at `123-456`; the user cannot overflow past 6 digits.

## Before / after

| | Before | After |
|---|---|---|
| Placeholder | `000000` | `000-000` |
| While typing `123456` | `123456` | `123-456` |
| Sent to backend | `123456` | `123456` (dash stripped) |
| maxlength | 6 | 7 |

### Live screenshots (production, https://vacprotocol.org/auth.html)

Placeholder state:

![OTP input placeholder showing 000-000](assets/S117-otp-dash-placeholder.png)

Typed state (`123-456`, dash auto-inserted):

![OTP input showing 123-456 with auto-inserted dash](assets/S117-otp-dash-typed.png)

## Verification

- Verified live on production after deploy: placeholder reads `000-000`.
- `formatOTPInput` on `123456` → `123-456` (confirmed in-page).
- Submit-side strip on `123-456` → `123456`, length 6 (confirmed in-page).
- Console errors observed are pre-existing MediaPipe WebGL warnings (headless has no
  GPU, falls back to timer) — unrelated to this change.
