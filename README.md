# Kickoff — World Cup 2026 Bet Game

A friends-only World Cup prediction game built with Next.js (App Router), Supabase (Postgres + Auth + Realtime + pg_cron), Tailwind, and the football-data.org API. Players join private leagues via invite links and submit predictions in two rounds:

- **Round 1** — pre-tournament: 1X2 picks for all 72 group-stage matches (WC 2026 has 104 matches total) + tournament winner, runner-up, golden boot, dark horse, and player props. Locks at first kickoff. Editable until then.
- **Round 2** — knockouts: R32 → R16 → QF → SF → Final bracket plus an overall champion pick. Opens after group stage, locks at knockout start.

Scoring is flat points (see `lib/scoring/rules.ts`). Friends' group-stage picks become visible to other league members once round 1 locks; bracket picks reveal per slot.

## Quick start

### 1. Create a Supabase project

1. Go to https://supabase.com → New project.
2. From **Settings → API**, copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
3. Enable extensions from **Database → Extensions**: `pg_cron`, `pg_net`, `pgcrypto`, `citext`.

### 2. Run the migrations

In Supabase **SQL Editor**, paste and run **every** file in `supabase/migrations/` in
numeric order (`0001_init.sql` → the highest-numbered file). The first three lay the
foundation (tables/RLS/lock triggers → scoring functions + leaderboard view → pg_cron
jobs); the rest are required follow-ups — skipping any leaves scoring or RLS broken.

Before applying `0003_cron.sql`, set these custom Postgres GUCs (Settings → Database → Custom Postgres config):

```
app.cron_app_url = 'https://your-deployed-app.vercel.app'
app.cron_secret  = 'pick-a-random-string'    # same value as CRON_SECRET env var
```

For local dev, skip migration 0003 — trigger sync manually from `/admin/sync`.

### 3. Set up football-data.org

1. Register at https://www.football-data.org/client/register — free tier covers the World Cup.
2. Copy the API token → `FOOTBALL_DATA_TOKEN`.

### 4. Set up auth email (recommended)

Supabase's default magic-link sender lands in spam for many providers. Wire up real SMTP:

- Create a free account at https://resend.com, verify a sending domain.
- Supabase dashboard → **Authentication → Emails → SMTP Settings** → paste Resend SMTP creds.

### 5. Configure environment variables

Copy `.env.example` to `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJh...
SUPABASE_SERVICE_ROLE_KEY=eyJh...
FOOTBALL_DATA_TOKEN=xxxxxxxxxxxx
CRON_SECRET=match-your-pg-guc-value
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 6. Install + run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

### 7. Bootstrap data

1. Sign up with your email. To bootstrap the very first owner, you'll need to bypass the invite-gating once — easiest is to set yourself as admin manually:
   ```sql
   update profiles set is_admin = true where username = 'your_username';
   ```
2. Visit `/admin/sync` → **Seed teams + players** → **Sync fixtures + results**.
3. Open `/admin/tournament` to confirm tournament timestamps.

### Creating a league + inviting friends

1. `/leagues` → **Create a league**.
2. `/leagues/[slug]/members` → **New invite** → copy the link.
3. Send link to friends. They open it → enter email → magic link → they're in the league.

## Project structure

```
app/
  (app)/                 # authenticated routes (predict, leagues, match, profile, admin)
  (auth)/                # login + join/[token] + welcome
  api/cron/              # cron endpoints called by pg_cron
  auth/                  # callback (magic link) + confirm (token_hash) handlers
  page.tsx               # landing
components/
  predict/               # MatchPickCard, BracketBuilder, OutcomesBoard, CountdownBanner
  banter/                # league chat feed + composers
  league-bets/           # crown/wooden-spoon voting + badges
  social/                # pick reactions
  stats/                 # PickPersonality profile card
  Nav, NavTabs, SignOutButton, CountryFlag, LocalKickoff
lib/
  supabase/              # server/browser/proxy clients + db types
  football-data/         # API client + sync orchestrator
  scoring/               # rules.ts (point values) + lock.ts
  predictions/actions    # server actions for picks
  leagues/actions        # create league, create/revoke invite
  admin/actions          # sync triggers, override match, toggle admin
  auth/invite            # token validate + consume
  stats/profile          # profile stats helpers
supabase/migrations/     # SQL: schema, scoring, cron
proxy.ts                 # Supabase session refresh (Next 16 proxy convention)
```

## Verification before kickoff

1. Run all migrations in order.
2. Seed teams + players → `/admin/sync`.
3. Run **Sync fixtures + results** at least once.
4. Sign up two emails (private window for the second) via an invite link.
5. As user A, submit a 1X2 pick on `/predict`.
6. Move the match's `kickoff_at` to past via SQL → confirm pick is read-only.
7. As user B, fetch the same match — confirm A's pick is now visible.
8. Manually set a match to `FINISHED` with a known result → confirm `point_awards` populates and the leaderboard updates live.
9. Re-run the cron endpoint with the same data — confirm no duplicate `point_awards` (idempotency).
10. Use `/admin/matches/[id]` to override a score → confirm points re-flow.

## Notes

- Friends' picks are gated by RLS — group-stage 1X2 picks reveal to shared-league members once round 1 locks (first kickoff); bracket picks reveal per slot.
- All scoring is idempotent via `point_awards.idempotency_key`. Re-running cron is safe.
- The bracket builder is the "Wall Chart" — a symmetric tournament poster. R32 entry cells are the official group-qualification matchups (they resolve to real teams as groups finish / fixtures import); downstream rounds fill top-down from your own picks.
- Point values live in two places — keep them in sync: `lib/scoring/rules.ts` (for UI display) and the `points_*` SQL functions spread across several migrations (for actual awarding) — see the points-sync invariant in `lib/scoring/CLAUDE.md` for the authoritative list. `lib/scoring/points-sync.test.ts` fails CI on drift in either direction.
