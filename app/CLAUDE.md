> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# app/ — Next.js 16 App Router

## Purpose
Next.js App Router routes for the whole app. Two route groups: `(app)` for auth-gated user
routes, `(auth)` for unauthenticated flows. `api/` holds only `cron/` (pg_cron triggers);
the auth callback/confirm route handlers live under `app/auth/`.

## Key files
- `layout.tsx` — Root HTML + font setup. No auth here.
- `global-error.tsx` — App Router top-level error boundary; reports to Sentry.
- `(app)/layout.tsx` — Auth wrapper + Nav for all gated routes. Calls
  `Sentry.setUser({ id, username })` (never email).
- `(app)/predict/page.tsx` — Round-1 group-stage 1X2 picks.
- `(app)/predict/outcomes/page.tsx` — Round-1 tournament-wide "outright" predictions
  (winner / runner-up / golden boot / over-unders / wildcards).
- `(app)/predict/bracket/page.tsx` — Round-2 knockout bracket builder.
- `(app)/match/[id]/` — Single-match detail: your pick, friends' picks (self-gated on
  `matchIsLocked`), reactions, live/finished state.
- `(app)/leagues/` — League list + create form; `[slug]/` league home (Top-5, banter,
  league bets); `[slug]/members/` roster, invites, owner-only member removal.
- `(app)/leagues/[slug]/leaderboard/` — Real-time league scoreboard (LeaderboardLive).
- `(app)/profile/[username]/` — Profile stats (points by type, Pick personality,
  recent picks).
- `(app)/admin/` — Admin dashboard (sync triggers, tournament config, user toggles,
  manual "house special" prop results at `/admin/props`, all-leagues + members
  overview at `/admin/leagues`).
- `(auth)/login/` — Magic-link / login-code entry.
- `(auth)/join/[token]/` — League invite redemption.
- `(auth)/welcome/` — Post-login username onboarding (gated by `profiles.onboarded`).
- `auth/callback/route.ts` — Supabase magic-link callback (legacy PKCE `?code=` path).
- `auth/confirm/route.ts` — Supabase `token_hash` verify handler (cross-browser email
  links; redirects into the callback's invite/leagues routing).
- `api/cron/` — pg_cron-triggered sync endpoints (see `api/cron/CLAUDE.md`).
- `globals.css` — Tailwind v4 entry; CSS variables for tokens.

## Conventions
- **Server Components by default**. Add `"use client"` only when you need state,
  effects, or browser APIs. Most data fetching belongs in server components or
  server actions, not in client effects.
- **Server actions** live in `lib/<area>/actions.ts` (e.g. `lib/predictions/actions.ts`).
  Import and call them from client components.
- **Auth**: server components use `supabaseServer()` from `lib/supabase/server.ts`;
  client components use `supabaseBrowser()` from `lib/supabase/client.ts`.
- **Route groups** `(app)` / `(auth)` do not add URL segments — they only segment
  layouts. Don't reference them in `href`s.
- **Dynamic params** use the Next.js 16 conventions; consult
  `node_modules/next/dist/docs/` before relying on training-data muscle memory.

## Invariants (do not break)
- Every page under `(app)/` MUST be gated by `(app)/layout.tsx`'s auth check — never
  duplicate auth logic in individual pages.
- Never call the Supabase **service-role** client (`supabaseService()`) from a route
  that runs in response to a user request without explicit authorization checks.
  Service-role bypasses RLS.
- API routes under `api/cron/` MUST verify `CRON_SECRET` — see `api/cron/CLAUDE.md`.

## Known gotchas
- Next.js 16 changed several conventions vs older training data. Read
  `node_modules/next/dist/docs/` for anything non-trivial (e.g. params, headers, cookies).
- Tailwind v4 uses CSS-first config in `globals.css`; there is no `tailwind.config.ts`.

## Recent changes
<!-- Newest first. Keep last 10. One line per entry. -->
- 2026-06-09: Kickoff times on `/match/[id]` and the league-page match rows now render in the **viewer's** timezone. Both called `isoToLocal()` during server render, which formats in the runtime's timezone (Vercel = UTC), so every user saw UTC kickoffs. New shared client component `components/LocalKickoff.tsx` defers the localized swap behind a rAF-driven effect — SSR + first client render emit a stable `—` placeholder (`suppressHydrationWarning` belt-and-braces), the effect swaps in the local string after mount — the same deferred-TZ pattern as `MatchPickCard` / `GroupStageList` / `CountdownBanner`, now reusable. `(app)/match/[id]/page.tsx` and `(app)/leagues/[slug]/page.tsx` stay Server Components and just mount it (they were the last two `isoToLocal` render call sites).
- 2026-06-09: Admin tournament-dates form (`(app)/admin/tournament/TournamentForm.tsx`) converts its `datetime-local` values to UTC ISO (`new Date(raw).toISOString()` — inverting `toLocalInput`'s display conversion) before calling `setTournamentDates`, which now validates the timestamps. Previously the raw timezone-less wall-time string went straight to Postgres, which read it as UTC — every save shifted `first_kickoff_at` / `knockout_start_at` / `final_at` (i.e. both round locks) by the admin's UTC offset.
- 2026-06-09: `(auth)/login/LoginForm.tsx` wraps both steps (send-code + verify) in try/catch with a pending reset, mirroring `WelcomeForm`: a network blip mid-server-action no longer leaves the button stuck on "Sending…" or bubbles an uncaught rejection to Sentry — an inline retry-friendly error surfaces instead. The verify step deliberately keeps `pending` true on success so the button reads "Verifying…" until `window.location.assign` actually navigates. Same PR: `(app)/leagues/[slug]/members/InviteControls.tsx` surfaces revoke/copy failures inline (clipboard rejections and `revokeInvite` errors previously vanished silently).
- 2026-06-09: League owners can remove a member from the member section. `(app)/leagues/[slug]/members/page.tsx` now selects `user_id` and renders a new owner-only client component `RemoveMemberButton.tsx` (two-step inline confirm, `router.refresh()` on success) on every non-owner row — the owner's own row keeps the `Owner` badge, non-owners see nothing. It calls the new `removeLeagueMember(leagueId, userId, leagueSlug)` action in `lib/leagues/actions.ts` (same explicit `owner_id === auth.uid()` + `supabaseService()` gate as `createInvite`; rejects removing the owner). The action deletes the `league_members` row — which alone drops the person from the roster / Top-5 / leaderboard / crown-spoon dropdowns (all key off `league_members`) — then tidies their league-scoped leftovers (`league_group_bets` votes either side, league-scoped `point_awards`, their `banter_messages` + `banter_replies` in this league; global `league_id IS NULL` awards untouched), refreshes `league_standings`, and revalidates the members / league / leaderboard paths. No migration — relies on the existing `league_members_owner_writes` RLS policy from `0001_init.sql`. The user's account and other leagues are untouched (re-invitable).
- 2026-06-09: New admin **Leagues** overview at `(app)/admin/leagues/page.tsx` (+ a `Leagues` link in `(app)/admin/layout.tsx`'s nav). Lists every league with its full roster — name, slug, description, created date, member count, and a members table (display name, `@username`, Owner/Member role, joined date; owner first then alphabetical), plus three summary stat cards (leagues / memberships / distinct players). Reads via the **service-role** client because `leagues` + `league_members` are member-scoped under RLS (the RLS-aware client would only show leagues the admin belongs to); guarded by an explicit `is_admin` re-check in the page (the route is already behind the admin layout) to satisfy the service-role authorization invariant. Read-only; no auth-flow / route-group / DB changes.
- 2026-06-09: The mobile nav menu (`components/NavTabs.tsx`, below `lg`) is now a **hamburger menu** so it reads as a multi-tab menu rather than a lone tab. The trigger leads with a three-line hamburger icon that animates into an ✕ when open, followed by the current tab's label (kept for the "you are here" cue) — replacing the previous current-tab-name + ▾ pill that users mistook for a single tab. `aria-label` toggles "Open menu" / "Close menu". The dropdown panel (all tabs, active one ✓-marked, dismiss on outside-click / Escape / route-change) and the `lg+` inline pill strip are unchanged. No auth / route / DB changes.
- 2026-06-09: `/welcome` username submit no longer reports transient network failures as uncaught "TypeError: Failed to fetch" to Sentry. `app/(auth)/welcome/WelcomeForm.tsx` switched from `useActionState` + `<form action={formAction}>` to a manual `useTransition` + `try/catch` around `await completeOnboarding(...)`, mirroring the `LoginForm.tsx` pattern (commit `4b6608b`, Sentry `JAVASCRIPT-NEXTJS-A`): a network blip mid-submit surfaces a retry-friendly inline error instead of bubbling to `window.unhandledrejection` for Sentry's auto-capture. Validation errors and the success-path `redirect()` (Next.js intercepts via the RSC response) are unchanged. Sentry `JAVASCRIPT-NEXTJS-B`.
- 2026-06-09: Nav tabs are now route-aware + mobile-friendly. Tab rendering moved out of `components/Nav.tsx`'s inline `NavLink` helper into a new client component `components/NavTabs.tsx` (`usePathname()`); `Nav` stays an async Server Component and just passes the tab list (`NavTab[]`, admin entry still conditional on `is_admin`). The active tab now **persistently** wears the former hover style (gold + ink border + shadow, `aria-current="page"`) so users see where they are — `/predict` matches **exactly** (so Group stage doesn't stay lit on `/predict/outcomes` / `/predict/bracket`), the rest match by prefix (so `/leagues/<slug>/…`, `/admin/…` keep their tab lit). Below the `lg` breakpoint the old `overflow-x-auto` side-scrolling strip is replaced by a compact dropdown (trigger pill shows the current tab + ▾; panel lists all tabs, active one ✓-marked; dismiss on outside-click / Escape / route-change); `lg+` keeps the inline strip with no horizontal scroll. No auth / route / DB changes.
- 2026-06-09: Removed the confusing copyable-looking invite "link" from the league-invite screen. `(auth)/join/[token]/page.tsx` no longer renders the monospace `kickoff.app/j/<token-prefix>` + "Invite" badge box above the email → OTP `LoginForm`; it was truncated to 12 chars and non-interactive (no copy/click), so users on the code-entry step misread it as something to copy or share. The "🎟 You've been invited" badge + "Join {league}" heading still convey the invite context, and `LoginForm`'s `inviteToken` flow is unchanged. No other route renders this box (`/login` never had it).
- 2026-06-08: New-user sign-in no longer requires entering email twice. Root cause: a brand-new (invited) user's first email is Supabase's "Confirm signup" template — no `{{ .Token }}` code (only the customised "Magic Link" template has one), and its link uses the implicit `token_hash`/URL-hash verify flow that the PKCE-only `api/auth/callback` (reads `?code=`) can't complete, so it bounced back to `/login`; the user only got a usable code on the second email entry. Fixes: (1) `verifyEmailOtp()` in `lib/auth/signIn.ts` tries `verifyOtp({type:"email"})` then falls back to `type:"signup"`, so a new user's confirm-signup code verifies on the same code screen; (2) new `app/auth/confirm/route.ts` (canonical Supabase-SSR `token_hash` handler) verifies the hashed token server-side — no PKCE code-verifier cookie, so it works cross-browser / in email-app webviews — then redirects to a same-origin `next` (default `/auth/callback`, which keeps the existing invite→`/join/[token]`→`/welcome` routing). `api/auth/callback` unchanged (legacy `?code=` PKCE path). **Required dashboard companion** (Auth → Email Templates): add `{{ .Token }}` to "Confirm signup" and repoint both templates' links at `/auth/confirm?token_hash={{ .TokenHash }}&type=<signup|magiclink>&next={{ .RedirectTo }}` (or disable "Confirm email" so new users get the code-bearing Magic Link template). Emailed code length stays a dashboard setting (Email OTP Length 6–10).
