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
- `(app)/predict/outcomes/page.tsx` — Round-1 tournament-wide "outright" predictions
  (winner / runner-up / golden boot / over-unders / wildcards).
- `(app)/predict/bracket/page.tsx` — Round-2 knockout bracket builder.
- `(app)/leagues/[slug]/leaderboard/` — Real-time league scoreboard (LeaderboardLive).
- `(app)/admin/` — Admin dashboard (sync triggers, tournament config, user toggles,
  manual "house special" prop results at `/admin/props`).
- `(auth)/login/` — Magic-link login.
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
- 2026-06-08: New-user sign-in no longer requires entering email twice. Root cause: a brand-new (invited) user's first email is Supabase's "Confirm signup" template — no `{{ .Token }}` code (only the customised "Magic Link" template has one), and its link uses the implicit `token_hash`/URL-hash verify flow that the PKCE-only `api/auth/callback` (reads `?code=`) can't complete, so it bounced back to `/login`; the user only got a usable code on the second email entry. Fixes: (1) `verifyEmailOtp()` in `lib/auth/signIn.ts` tries `verifyOtp({type:"email"})` then falls back to `type:"signup"`, so a new user's confirm-signup code verifies on the same code screen; (2) new `app/auth/confirm/route.ts` (canonical Supabase-SSR `token_hash` handler) verifies the hashed token server-side — no PKCE code-verifier cookie, so it works cross-browser / in email-app webviews — then redirects to a same-origin `next` (default `/auth/callback`, which keeps the existing invite→`/join/[token]`→`/welcome` routing). `api/auth/callback` unchanged (legacy `?code=` PKCE path). **Required dashboard companion** (Auth → Email Templates): add `{{ .Token }}` to "Confirm signup" and repoint both templates' links at `/auth/confirm?token_hash={{ .TokenHash }}&type=<signup|magiclink>&next={{ .RedirectTo }}` (or disable "Confirm email" so new users get the code-bearing Magic Link template). Emailed code length stays a dashboard setting (Email OTP Length 6–10).
- 2026-06-08: Admins can enter results for seven manually-resolved "house special" props. New `(app)/admin/props/page.tsx` + `ManualPropsForm.tsx` (Yes/No selects, team / goalkeeper / group-match dropdowns, two number inputs) posts to `setManualPropResolutions` (`lib/admin/actions.ts`), which upserts the `manual_prop_resolutions` table (one row per `prop_key`; blank field = delete the row = unresolved) then runs `score_manual_props()` + `refresh_league_standings`. New `Props` link in the admin nav (`(app)/admin/layout.tsx`). User side: `(app)/predict/outcomes/page.tsx` now fetches group fixtures (shared `lib/predictions/group-matches.ts` helper) for the war-game match picker and passes the seven new `tournament_predictions` columns (migration `0022`) into a new "House specials" zone in `<OutcomesBoard>`.
- 2026-06-08: Removed the group-winners picker from the Outcomes tab. `(app)/predict/outcomes/page.tsx` dropped its `group_winner_predictions` fetch + `teamsByGroup` / `groupPicks` derivations and the props passed to `<OutcomesBoard>`; the `/predict` cross-link copy no longer says "group winners". The pick was redundant with the group-stage 1X2 picks (which already imply each group's winner); scoring retired in migration `0021_remove_group_winner_prop.sql`, `POINTS.tournament.groupWinner` dropped from `lib/scoring/rules.ts`.
- 2026-06-08: Tournament outcomes & player props split out of `/predict` into a new `(app)/predict/outcomes/page.tsx` tab. `/predict` is now a focused group-stage 1X2 board (it dropped the `tournament_predictions` / `player_prop_predictions` / `group_winner_predictions` / teams / players fetches + the catalogue Sentry captures + the `fetchAllPlayers` helper — all moved to the new page) and gained a cross-link to Outcomes. The new page owns the catalogue fetch (teams split into core + `fifa_ranking`-allowed-to-fail, paginated `fetchAllPlayers`, Sentry captures retagged `outcomes:`) and renders `<OutcomesBoard>` with the winner/runner-up/golden-boot/over-under/wildcard props **and** the 12 group winners. It reads `tournament_predictions` directly via the now-typed Row (no `Record<string, unknown>` cast), including the four new columns from migration `0020`. Locks at `first_kickoff_at` (round 1) like the 1X2 page. `components/Nav.tsx`: 1X2 tab relabelled `Round 1` → `Group stage`, new `Outcomes` link inserted before `Bracket`.
- 2026-06-08: `/predict` top-scorer & troublemaker player dropdowns no longer truncate at ~1000 players. `app/(app)/predict/page.tsx` fetched the players catalogue with a single `.order("name").limit(1000)`, but WC 2026 has ~1,100+ players (48 teams × full squads), so the alphabetically-ordered list cut off around "O". Replaced with a module-level `fetchAllPlayers(client)` helper that range-paginates (1000/page, ordered `(name, id)` for stable paging) and returns the same `{ data, error }` shape — the existing `playersRes` Sentry capture and the `players` mapping are untouched. `PlayerSelect.tsx` / `TournamentForm.tsx` unchanged. (The sibling "Total Goals" schema-cache error is a DB-side issue — migration `0005` unapplied — not fixed in code; remediation is `supabase db push` + `notify pgrst, 'reload schema';`.)
- 2026-06-04: New-user onboarding / username picker. A new `/welcome` screen (`app/(auth)/welcome/page.tsx` + `WelcomeForm.tsx`) lets a user choose their own username after OTP login, before entering the app. Driven by a new `profiles.onboarded` flag (migration `0015`): `app/(app)/layout.tsx` now selects `username, onboarded` (via `.maybeSingle()`) and `redirect("/welcome")`s any authenticated, non-onboarded user — one gate covering every `(app)` route. `/welcome` lives in `(auth)` (which has no layout) so the gate can't loop; it does its own auth check and bounces already-onboarded users to `?next`. `app/(auth)/join/[token]/page.tsx` sends new users to `/welcome?next=/leagues/<slug>` after a successful consume (onboarded users go straight to the league). Persistence + validation live in the new `lib/profile/actions.ts` (`completeOnboarding`) / `lib/profile/validation.ts`. `lib/auth/signIn.ts` and `app/auth/callback/route.ts` are unchanged — invites already funnel through `/join/[token]`.
- 2026-06-04: Magic-link login gained a code-entry path. `(auth)/login/LoginForm.tsx` is now a two-phase client form: email step (`signInWithEmail`, unchanged) → numeric code step verified by the new `verifyEmailOtp()` server action in `lib/auth/signIn.ts` (`supabase.auth.verifyOtp({ email, token, type: "email" })`). Verify runs in a Server Action so `supabaseServer()`'s cookie adapter persists the session; the client then `window.location.assign`es to the returned `redirectTo` (`/leagues`, or `/join/[token]` when an invite is present, reusing the magic-link callback's single redemption path). The link still works — Supabase puts both `{{ .ConfirmationURL }}` and `{{ .Token }}` in the same email. `(auth)/login/page.tsx` copy + badge changed from "magic link" to "login code". Emailed code length is a Supabase dashboard setting (Auth → Providers → Email → Email OTP Length, 6–10), not in code.
- 2026-06-02: Removed the `DEV_INSTANT_LOGIN` instant-login bypass entirely ahead of production onboarding. `lib/auth/signIn.ts` dropped its dev branch (and the now-unused `supabaseService` / `consumeInviteForUser` imports + the `mode: "instant"` `SignInResult` variant); magic-link via `signInWithOtp` is now the only sign-in path. `(auth)/login/page.tsx`, `(auth)/join/[token]/page.tsx`, and `login/LoginForm.tsx` lost the `devInstant` prop and its badge/helper/button-label branches. The `app/auth/callback/route.ts` comment no longer references the dev flow. The `DEV_INSTANT_LOGIN=` line still needs deleting from `.env.example` (harness-protected, can't edit from here). Removes the P0 foot-gun flagged in `CODE_REVIEW.md` §2.
- 2026-05-26: Database types regenerated to the supabase-CLI `Database` namespace shape and `<Database>` wired through `supabaseServer()` / `supabaseBrowser()` / `supabaseService()`. Every `home:home_team_id(...)` / `away:away_team_id(...)` embedded relation in `/leagues/[slug]`, `/match/[id]`, `/predict`, `/profile/[username]`, `/admin/matches*` was migrated to the `home:teams!home_team_id(...)` column-hint syntax — supabase-js's typed select parser rejects the legacy form with `SelectQueryError<"Could not embed because more than one relationship was found for 'teams' and 'matches'...">` (PostgREST itself accepts both forms; the runtime query is unchanged). `unwrapRelation()` casts dropped from all 10 call sites — the new typing already produces `T | null` for single-FK embedded relations. `app/(app)/match/[id]/page.tsx` live indicator: typed `match.status` finally surfaced an `IN_PLAY`/`PAUSED` comparison that never matched the DB enum (`SCHEDULED | LIVE | FINISHED | POSTPONED`) — fixed to `=== "LIVE"`. `app/(app)/leagues/[slug]/leaderboard/page.tsx` now casts the view query result to `LeagueStandingsRow[]` at the boundary because `Tables<"league_standings">` declares every column nullable (the `coalesce(sum(...), 0)::int` in the view SQL isn't visible to the generator). Closes #14.
- 2026-05-26: `/leagues` member count switched from "fetch all rows, count client-side" to one PostgREST aggregate query — `.select("league_id, member_count:user_id.count()")` returns one row per league with the count pre-aggregated. Root `proxy.ts` matcher now excludes `/api/cron/*` and `/_next/data/*` so cron handlers don't trigger a Supabase session refresh on every pg_cron hit. Cron `authorized()` helper extracted to `lib/cron/auth.ts` (`authorizedCron(request)`) and now uses `crypto.timingSafeEqual` instead of `===`. Refs #17.
