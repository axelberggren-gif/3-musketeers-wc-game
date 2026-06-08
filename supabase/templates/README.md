# supabase/templates/ — Auth email templates (reference copies)

These are version-controlled copies of the **Supabase Auth → Email Templates**
used by the hosted project. The cloud dashboard is the source of truth at
runtime; **editing the files here does NOT deploy anything**. Keep the two in
sync by hand — when you change a template in the dashboard, paste it back here
in the same PR (and vice-versa).

## Files
- `confirm-signup.html` — the **"Confirm signup"** template (brand-new users).
- `magic-link.html` — the **"Magic Link"** template (returning users).

They are byte-for-byte identical **except one line** — the one-tap button's
verify `type`:
- `confirm-signup.html`: `…/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next={{ .RedirectTo }}`
- `magic-link.html`: `…/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next={{ .RedirectTo }}`

## Why they exist (the bug they fix)
A brand-new (invited) user used to have to enter their email **twice**. Their
first email is the "Confirm signup" template, which by default carries **no
`{{ .Token }}` code** and whose default link rides the implicit `token_hash`
flow that the PKCE-only `app/auth/callback` route can't complete — so it bounced
the user back to `/login`. See PR #109 and `app/CLAUDE.md`.

These templates fix it two ways, matching the code shipped in #109:
1. **`{{ .Token }}` is shown prominently** — the numeric code is the primary
   path. `verifyEmailOtp()` (`lib/auth/signIn.ts`) accepts it on the code screen
   (it tries `type:"email"`, then falls back to `type:"signup"`).
2. **The button points at `/auth/confirm`** — the server-side `token_hash`
   handler (`app/auth/confirm/route.ts`) needs no PKCE cookie, so the link works
   cross-browser / in email-app webviews, then redirects to `next`
   (`{{ .RedirectTo }}` → `/auth/callback`, preserving invite → `/welcome`).

## How to apply
1. Supabase dashboard → **Auth → Email Templates**.
2. Paste `confirm-signup.html` into **Confirm signup** and `magic-link.html`
   into **Magic Link** (Source/HTML view).
3. Confirm the required settings below.

## Required dashboard settings (companion to these templates)
- **Email OTP Length** (Auth → Providers → Email): 6–10. Controls the
  `{{ .Token }}` length; not a code change.
- **Redirect URLs allow-list** (Auth → URL Configuration): the **Site URL** must
  be set, and the allow-list must include the post-verify target the app uses
  (`/auth/callback`, which `emailRedirectTo` points at). `/auth/confirm` is a
  same-origin route on the Site URL, so it needs no extra entry.
- Either keep "Confirm email" **on** (these templates make the confirm email
  usable), **or** turn it **off** so new users get the Magic Link template
  directly — both work with the shipped code.

## Previewing
Opening the `.html` files in a browser renders `{{ .Token }}` etc. literally.
To eyeball the design, temporarily swap `{{ .Token }}` for a sample like
`482913` and the `href` for `#`.

## Email-client caveats (by design, graceful)
- **Web fonts** (Archivo Black / DM Mono) render in Apple Mail / iOS; Gmail and
  Outlook strip them and fall back to Arial / Courier — still on-brand.
- The **hard offset shadow** (`box-shadow`) shows in most clients; Outlook
  desktop drops it to a plain 2px border. Layout is table-based + inline-styled
  so it holds up everywhere.
