> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# app/ — Next.js 16 App Router

## Purpose
Next.js App Router routes for the whole app. Two route groups: `(app)` for auth-gated user
routes, `(auth)` for unauthenticated flows. `api/` holds server routes (auth callback +
cron triggers).

## Key files
- `layout.tsx` — Root HTML + font setup. No auth here.
- `global-error.tsx` — App Router top-level error boundary; reports to Sentry.
- `(app)/layout.tsx` — Auth wrapper + Nav for all gated routes. Calls
  `Sentry.setUser({ id, username })` (never email).
- `(app)/predict/page.tsx` — Round-1 group-stage 1X2 picks.
- `(app)/predict/bracket/page.tsx` — Round-2 knockout bracket builder.
- `(app)/leagues/[slug]/leaderboard/` — Real-time league scoreboard (LeaderboardLive).
- `(app)/admin/` — Admin dashboard (sync triggers, tournament config, user toggles).
- `(auth)/login/` — Email 6-digit code login (two-step: request code, then verify).
- `(auth)/join/[token]/` — League invite redemption.
- `api/auth/callback/` — Supabase magic-link callback.
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
- 2026-06-02: Sign-in switched from clickable magic links to a **6-digit email code** (two-step `LoginForm`: email → code). Corporate email link-scanners were pre-fetching the one-time magic link and burning the token, so real clicks failed with `otp_expired`; the PKCE link flow also depended on a `code_verifier` cookie that breaks cross-device. `lib/auth/signIn.ts` keeps `signInWithEmail` (now just `signInWithOtp`, no `emailRedirectTo`/`NEXT_PUBLIC_APP_URL`) and adds `verifyEmailCode(email, token, inviteToken?)` which calls `verifyOtp({ type: "email" })` — sets the SSR session cookies directly, no `/auth/callback` round-trip — then redeems any invite and returns `redirectTo`. `(auth)/login/page.tsx` copy now reads "Email code". `app/auth/callback/route.ts` is retained for any residual link clicks but is no longer the primary path. **Dashboard config required**: set the Supabase *Magic Link* email template to render `{{ .Token }}`. Was: magic-link via `signInWithOtp` only.
- 2026-06-02: Removed the `DEV_INSTANT_LOGIN` instant-login bypass entirely ahead of production onboarding. `lib/auth/signIn.ts` dropped its dev branch (and the now-unused `supabaseService` / `consumeInviteForUser` imports + the `mode: "instant"` `SignInResult` variant); magic-link via `signInWithOtp` is now the only sign-in path. `(auth)/login/page.tsx`, `(auth)/join/[token]/page.tsx`, and `login/LoginForm.tsx` lost the `devInstant` prop and its badge/helper/button-label branches. The `app/auth/callback/route.ts` comment no longer references the dev flow. The `DEV_INSTANT_LOGIN=` line still needs deleting from `.env.example` (harness-protected, can't edit from here). Removes the P0 foot-gun flagged in `CODE_REVIEW.md` §2.
- 2026-05-26: Database types regenerated to the supabase-CLI `Database` namespace shape and `<Database>` wired through `supabaseServer()` / `supabaseBrowser()` / `supabaseService()`. Every `home:home_team_id(...)` / `away:away_team_id(...)` embedded relation in `/leagues/[slug]`, `/match/[id]`, `/predict`, `/profile/[username]`, `/admin/matches*` was migrated to the `home:teams!home_team_id(...)` column-hint syntax — supabase-js's typed select parser rejects the legacy form with `SelectQueryError<"Could not embed because more than one relationship was found for 'teams' and 'matches'...">` (PostgREST itself accepts both forms; the runtime query is unchanged). `unwrapRelation()` casts dropped from all 10 call sites — the new typing already produces `T | null` for single-FK embedded relations. `app/(app)/match/[id]/page.tsx` live indicator: typed `match.status` finally surfaced an `IN_PLAY`/`PAUSED` comparison that never matched the DB enum (`SCHEDULED | LIVE | FINISHED | POSTPONED`) — fixed to `=== "LIVE"`. `app/(app)/leagues/[slug]/leaderboard/page.tsx` now casts the view query result to `LeagueStandingsRow[]` at the boundary because `Tables<"league_standings">` declares every column nullable (the `coalesce(sum(...), 0)::int` in the view SQL isn't visible to the generator). Closes #14.
- 2026-05-26: `/leagues` member count switched from "fetch all rows, count client-side" to one PostgREST aggregate query — `.select("league_id, member_count:user_id.count()")` returns one row per league with the count pre-aggregated. Root `proxy.ts` matcher now excludes `/api/cron/*` and `/_next/data/*` so cron handlers don't trigger a Supabase session refresh on every pg_cron hit. Cron `authorized()` helper extracted to `lib/cron/auth.ts` (`authorizedCron(request)`) and now uses `crypto.timingSafeEqual` instead of `===`. Refs #17.
- 2026-05-25: `/predict` Tournament outcome team dropdowns no longer empty out when migration 0005 hasn't been applied. Sentry caught the root cause (`42703: column "teams.fifa_ranking" does not exist`) via the capture added in PR #51. `app/(app)/predict/page.tsx` now splits the catalogue into two queries — `select("id, name, code, group_letter")` (always present) and `select("id, fifa_ranking")` (0005-dependent, allowed to fail) — and merges them via a `rankingByTeamId` Map. Only the dark-horse rank-sort degrades when 0005 is missing; every picker stays populated. The rank failure is still Sentry-captured (level `warning`) so the migration drift remains visible. Refs #47.
- 2026-05-25: `/predict` server component now `Sentry.captureMessage`s `teamsRes.error` and `playersRes.error` (tagged `feature=tournament_predictions`) before the `?? []` coalesces empty out the Tournament outcome dropdowns. The trigger is a migration not applied to the target DB — most recently the 0005 `teams.fifa_ranking` column referenced in the `teams` select; PostgREST 400s the whole query and data goes null. Captures include `pg_code` / `pg_message` / `pg_details` / `pg_hint` so the next drift is diagnosed from the Sentry event without a database probe. Refs #47.
- 2026-05-25: League home (`(app)/leagues/[slug]/page.tsx`) restructured to a 2-column desktop layout (`lg:grid-cols-[1.8fr_1fr]`, stacks on mobile). The right sidebar mounts `<BanterFeed>` — initial data (~50 messages + their replies + league-member profile map) fetched server-side; live updates via the `league:<id>:banter` Supabase Realtime channel. See `components/banter/CLAUDE.md` and migration `0011_banter.sql`.
- 2026-05-25: Pick reactions land on `/match/[id]` and `/profile/[username]`. The match page's `friendsPicks` select now pulls `match_predictions.id` so each `<li>` can host a `<PickReactionStrip>` (gold/paper-2 chip pill, dashed `+ react` trigger with upward popover, optimistic toggle with rollback). The profile page gained a "Recent picks" section between the stats grids and the placeholder personality card, listing the owner's last 10 match predictions (RLS already gates kickoff-passed + league-mate visibility) with the same reaction strip. Aggregates are loaded server-side via `loadPickReactions()` (single round-trip). Closes #36.
- 2026-05-24: Invite-redemption flow stops silently dumping users on `/leagues` when `consumeInviteForUser()` returns `!ok`. `lib/auth/invite.ts` `Sentry.captureMessage`s both RPC errors and `!row.ok` cases (with token prefix, user_id, raw error/row shape) so the underlying cause can be diagnosed. `lib/auth/signIn.ts` (DEV_INSTANT path) returns `{ ok: false, error }` instead of routing to `/leagues`; `LoginForm` already surfaces the inline error. `app/auth/callback/route.ts` now bounces through `/join/[token]` after exchanging the magic-link code so the single redemption code path handles both flows. `app/(auth)/join/[token]/page.tsx` renders a "Couldn't join" error state for an authenticated user whose consume failed, instead of misleadingly showing the login form again.
- 2026-05-24: `(auth)/join/[token]/page.tsx` no longer calls `setPendingInvite(token)` — Next.js 16 hard-errors on cookie writes outside Server Actions / Route Handlers, and Sentry caught the crash in production. The invite token already flows through the magic-link `?invite=` URL param (LoginForm prop → `signInWithEmail` → `emailRedirectTo`), so the cookie fallback was redundant. `lib/auth/invite.ts` lost the cookie helpers (`setPendingInvite`/`readPendingInvite`/`clearPendingInvite`) and `app/auth/callback/route.ts` simplified to a single `?invite=` read.
