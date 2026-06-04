# Email / auth delivery setup

How sign-in email is sent for Kickoff '26. Sign-in is a **6-digit email code** (not a
magic link) — corporate inbox link-scanners pre-fetch one-time links and burn the token
(`otp_expired`), and the PKCE link flow breaks cross-device. Delivery goes through
**Resend SMTP** because Supabase's built-in sender is heavily rate-limited.

## Flow (code)
- `lib/auth/signIn.ts`
  - `signInWithEmail(email, inviteToken?)` → `supabase.auth.signInWithOtp(...)` — sends the code.
    `shouldCreateUser` is `!!inviteToken` (only invited newcomers may create an account).
  - `verifyEmailCode(email, token, inviteToken?)` → `supabase.auth.verifyOtp({ type: "email" })` —
    writes the SSR session cookies directly (no `/auth/callback`, no `code_verifier`,
    works cross-device), then redeems any invite and returns `redirectTo`.
- `app/(auth)/login/LoginForm.tsx` — two-step UI: enter email → enter code.
- `app/auth/callback/route.ts` — retained for residual link clicks; not the primary path.

## Resend
- Account → **Add Domain** → `worldcup.strativ.se`, region **EU (eu-west-1)**.
- Use **Manual setup** (we don't control the corporate DNS via Resend's Cloudflare auto-config).
- Verify the domain (status must read **Verified**), then **API keys → Create API Key**
  (sending access). The key (`re_…`) is the SMTP password.
- Free tier: 1 domain, 3,000 emails/month, 100/day.

### DNS records (handed to DevOps, added to the `strativ.se` zone)
Names are written relative to the `strativ.se` zone — enter as-is (don't double-append the zone).

| Type | Host/Name | Value | Priority |
|------|-----------|-------|----------|
| TXT | `resend._domainkey.worldcup` | `p=…` (long DKIM key from Resend) | — |
| MX  | `send.worldcup` | `feedback-smtp.eu-west-1.amazonses.com` | 10 |
| TXT | `send.worldcup` | `v=spf1 include:amazonses.com ~all` | — |
| TXT *(optional)* | `_dmarc.worldcup` | `v=DMARC1; p=none;` | — |

Notes for DevOps:
- All records are scoped under `worldcup` / `send.worldcup` — the root `strativ.se`
  MX/SPF/DMARC (corporate mail) is untouched.
- The DKIM TXT value is long (>255 chars); split into 255-char quoted chunks if the DNS
  tool requires it (Cloudflare / Route 53 do this automatically).

## Supabase — SMTP
**Authentication → Emails → SMTP Settings** → enable custom SMTP:

| Field | Value |
|-------|-------|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the Resend `re_…` API key |
| Sender email | `noreply@worldcup.strativ.se` |
| Sender name | `Kickoff '26` |

There is no separate "SMTP" page in Resend — SMTP just reuses an API key as the password.

## Supabase — email templates
**Authentication → Emails → Templates.** Update **both**:
- **Magic Link** — used when an *existing* user signs in.
- **Confirm signup** — used when a *new* user signs up (the invite-link onboarding flow).

Both must render the code with `{{ .Token }}`, or the email looks empty (the default body
is a `{{ .ConfirmationURL }}` link, which we don't use).

Subject: `Your Kickoff '26 sign-in code`

Branded body (cream/ink/gold sticker theme; falls back to Arial Black / system mono in
clients that don't load custom fonts; `box-shadow` ignored by Outlook):

```html
<!-- Kickoff '26 — sign-in code -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4ecdc; margin:0; padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background:#fffdf7; border:2px solid #0e1118; border-radius:14px; box-shadow:6px 6px 0 #0e1118;">
      <tr><td style="padding:28px 28px 8px;">
        <span style="display:inline-block; background:#0e1118; color:#ffc043; font-family:'Archivo Black','Arial Black',Arial,sans-serif; font-size:16px; letter-spacing:1px; padding:8px 12px; border:2px solid #0e1118; border-radius:8px;">
          ⚽ KICKOFF<span style="color:#7bc890; font-size:11px;">&nbsp;'26</span>
        </span>
      </td></tr>
      <tr><td style="padding:12px 28px 0;">
        <h1 style="margin:0 0 8px; font-family:'Archivo Black','Arial Black',Arial,sans-serif; font-size:26px; line-height:1.1; color:#0e1118; text-transform:uppercase;">Your sign-in code</h1>
        <p style="margin:0; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.5; color:#4a5063;">Enter this code to sign in. It expires shortly and can only be used once.</p>
      </td></tr>
      <tr><td align="center" style="padding:24px 28px;">
        <div style="display:inline-block; background:#ffc043; color:#0e1118; font-family:'DM Mono',ui-monospace,Menlo,Consolas,monospace; font-size:38px; font-weight:700; letter-spacing:10px; padding:18px 24px 18px 34px; border:2px solid #0e1118; border-radius:12px; box-shadow:4px 4px 0 #0e1118;">{{ .Token }}</div>
      </td></tr>
      <tr><td style="padding:0 28px 28px;">
        <p style="margin:0; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:13px; line-height:1.5; color:#8a8f9c;">Didn't request this? You can safely ignore this email — no one can sign in without the code.</p>
      </td></tr>
    </table>
    <p style="margin:16px 0 0; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; color:#a39a82;">Kickoff '26 · World Cup prediction league</p>
  </td></tr>
</table>
```

## Supabase — rate limits
**Authentication → Rate Limits** → raise the emails-per-hour cap. Supabase keeps its own
throttle even with custom SMTP; the built-in default is low.

## Testing
1. Existing user: deployed `/login` → enter email → code arrives from
   `noreply@worldcup.strativ.se` → enter it → lands on `/leagues`.
2. New user: open a league invite link (`/join/[token]`) → enter email → code → joins the
   league. (This exercises the **Confirm signup** template.)
3. Send to an **external** inbox (e.g. a personal Gmail/Hotmail), not just `@strativ.se`, to
   confirm it isn't spam-foldered.

## Troubleshooting
| Symptom | Cause / fix |
|---------|-------------|
| Email arrives empty | Template missing `{{ .Token }}` — update **both** Magic Link and Confirm signup. |
| `otp_expired` on a fresh link | Link flow consumed by an email scanner — that's why we use a code, not a link. |
| Send fails / not delivering | Domain not **Verified** in Resend, or SMTP creds wrong (password must be the API key). |
| Hits spam | Verify DKIM/SPF are green in Resend; consider adding the optional `_dmarc.worldcup` record. |
| Throttled after a few sends | Raise the Supabase **Rate Limits** email cap. |

## Env note
`NEXT_PUBLIC_APP_URL` is no longer used by the sign-in flow (the code path doesn't redirect),
so the redirect-URL allowlist and Site URL config aren't needed for auth.
