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
- `(auth)/login/` — Magic-link login (or `DEV_INSTANT_LOGIN` bypass).
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
- 2026-05-24: `(auth)/join/[token]/page.tsx` no longer calls `setPendingInvite(token)` — Next.js 16 hard-errors on cookie writes outside Server Actions / Route Handlers, and Sentry caught the crash in production. The invite token already flows through the magic-link `?invite=` URL param (LoginForm prop → `signInWithEmail` → `emailRedirectTo`), so the cookie fallback was redundant. `lib/auth/invite.ts` lost the cookie helpers (`setPendingInvite`/`readPendingInvite`/`clearPendingInvite`) and `app/auth/callback/route.ts` simplified to a single `?invite=` read.
- 2026-05-22: Sentry integration wired (errors + errors-only session replay). New `/instrumentation-client.ts`, `/instrumentation.ts`, `/sentry.server.config.ts`, `/sentry.edge.config.ts`, `app/global-error.tsx`. `(app)/layout.tsx` calls `Sentry.setUser({ id, username })` (never email). Cron routes + admin actions tagged on capture. No-op when `NEXT_PUBLIC_SENTRY_DSN` unset. See `lib/sentry/CLAUDE.md`.
- 2026-05-22: Sticker Stadium visual identity rolled out. `globals.css` swapped dark-theme tokens for cream paper + ink palette (`--paper`, `--ink`, `--pitch`, `--gold`, `--coral`, …) and added sticker primitives (`.sticker`, `.holo`, `.badge-*`, etc.). `layout.tsx` now loads Archivo Black / Inter / DM Mono. Every user-facing route (`/`, `/login`, `/join/[token]`, `/leagues`, `/leagues/[slug]/*`, `/predict`, `/predict/bracket`, `/match/[id]`, `/profile/[username]`) redesigned. `/predict` got a group chip strip that flips pitch-green ✓ when all matches in that group have picks. Misalignments tracked in `/DESIGN_MISALIGNMENTS.md`.
