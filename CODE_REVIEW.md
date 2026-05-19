# Code Review — 3 Musketeers WC Bet Game

Scope: every TS/SQL file currently on `main`, plus the supporting docs. The
review's aim is to surface things that will bite us between now and first
kickoff (2026-06-11), in priority order. Severity legend:

- **P0** — broken behavior or production risk; fix before any further feature
  work.
- **P1** — real bug or design flaw that will hurt us during the tournament.
- **P2** — code-health / DX issue. Worth doing but not urgent.

---

## 1. P0 — Bracket scoring is silently broken: `matches.bracket_slot` is never populated

`score_bracket()` joins picks to matches on
`m.bracket_slot = bp.bracket_slot`
(`supabase/migrations/0002_scoring.sql:89`). But `syncFixtures()` never
writes `bracket_slot` on the upsert payload
(`lib/football-data/sync.ts:82-94`) — `stage` and `group_letter` are set,
`bracket_slot` is omitted. There's also no admin UI that backfills it. So
the join produces zero rows, and bracket points are never awarded.

The `'W'` (champion) special case has the same problem: it joins on
`m.bracket_slot = 'F'` (`0002_scoring.sql:108`), which is also never
populated.

**Suggested fix.** Map football-data's match ordering inside knockout stages
to our slot labels (`R16-1..8`, `QF-A..D`, `SF-A..B`, `F`) in
`mapStage()` or a new helper, then write `bracket_slot` in the `syncFixtures`
upsert. Add a migration that backfills slots for any matches the sync has
already imported. Add a regression test against `score_bracket` that runs
the function on a fixture with one finished knockout match and asserts a
single award.

---

## 2. P0 — `DEV_INSTANT_LOGIN` is a production foot-gun

`lib/auth/signIn.ts:22` opts into the bypass solely on
`process.env.DEV_INSTANT_LOGIN === "true"`. If that env var ever leaks into
the production deployment (copy/paste from `.env.local`, a Vercel
preview-vs-prod mixup, a teammate adding it to the wrong environment), any
visitor who knows a user's email can log in as them — `signInWithEmail`
calls `service.auth.admin.generateLink` and verifies the OTP server-side,
fully bypassing the magic-link round-trip.

**Suggested fix.** Hard-fail at module load if `DEV_INSTANT_LOGIN === "true"`
and `process.env.NODE_ENV === "production"` (or `VERCEL_ENV === "production"`).
Either throw or silently treat as off. Add a one-line note to README.md so
nobody is surprised when their prod login stops working.

---

## 3. P1 — Admin override doesn't trigger tournament-level rescoring

`overrideMatchResult` (`lib/admin/actions.ts:70-101`) calls `score_match`
and `score_bracket` after updating a match, but never `score_tournament`.
`syncFixtures()` has the same gap (`lib/football-data/sync.ts:109-119`).

If the Final is corrected (wrong winner pulled from football-data, or a
result change from FIFA), the per-match bracket awards re-flow but the
tournament-level awards — winner, runner-up, dark-horse, top-scorer —
silently stay stale. Same for the player-prop awards. Given the high
point values (25 for winner, 15 for top-scorer), this is the single most
visible bug class for end users.

**Suggested fix.** After `score_match`+`score_bracket`, also call
`supabase.rpc("score_tournament")` whenever the touched match is the
Final (`stage = 'F'` or `bracket_slot = 'F'`). Wrap both call sites
(`overrideMatchResult` + `syncFixtures`) in the same helper so they
can't drift.

---

## 4. P1 — `score_bracket()` and `score_tournament()` return wrong row counts

In both functions, `get diagnostics awarded = row_count` runs once at the
end (`0002_scoring.sql:118-119` and `0002_scoring.sql:210-211`) — but the
function body contains multiple `INSERT` statements. `GET DIAGNOSTICS`
only reports the last statement's affected rows, so the returned count is
just the rows from the final insert (the player-prop insert in
`score_tournament`, the `'W'` insert in `score_bracket`).

This is mostly a metrics/log lie today (we log "scored N picks" in
`syncFixtures`), but anyone reading those logs to debug missing awards
will be misled.

**Suggested fix.** Accumulate manually:

```sql
declare
  delta integer := 0;
begin
  insert into point_awards ... ;
  get diagnostics delta = row_count;
  awarded := awarded + delta;
  -- repeat after each insert
end;
```

---

## 5. P1 — Race condition on invite redemption

`consumeInviteForUser` (`lib/auth/invite.ts:69-79`):

```ts
const { data: cur } = await service
  .from("league_invites").select("uses_count")...
await service
  .from("league_invites")
  .update({ uses_count: (cur.uses_count ?? 0) + 1 }) ...
```

Two redemptions hitting in parallel both read `uses_count = N`, both write
`N+1`, and the cap can be exceeded silently. With `max_uses = 25` and
WhatsApp-shared links, that absolutely will happen the night you send the
invite.

**Suggested fix.** One atomic statement:

```ts
await service.rpc("increment_invite_uses", { id: validated.invite_id });
```

backed by a SQL function that does `update league_invites set uses_count =
uses_count + 1 where id = $1 and (max_uses is null or uses_count <
max_uses)` and reports affected rows. Better still: enforce `uses_count <
max_uses` as a SQL check / constraint, so abuse becomes impossible at the
DB layer.

---

## 6. P1 — N+1 in `syncFixtures()` will smoke the football-data rate limit

For every match returned (typically ~64), `syncFixtures` runs
`teamUuidByExternal` twice — once for home, once for away
(`lib/football-data/sync.ts:76-77`). That's ~128 round-trips per sync, on
top of the football-data fetch. The cron fires every 10 minutes
(`0003_cron.sql:53`). Network cost aside, this also widens the window for
race conditions against `seedTeams`.

**Suggested fix.** Prefetch the teams table once per call:

```ts
const { data: allTeams } = await supabase
  .from("teams")
  .select("id, external_id");
const teamByExternal = new Map(allTeams!.map(t => [t.external_id, t.id]));
```

then look up from the Map. Same pattern in `seedTeams()`
(`lib/football-data/sync.ts:39-53`), which currently does a second SELECT
per team to grab the local UUID before patching player rows.

---

## 7. P1 — `loadProfileStats` mixes two RLS-scoped result sets, so accuracy is wrong for any non-self profile

`lib/stats/profile.ts:15-49` runs two queries:

- `match_predictions` — RLS scopes this to picks the viewer can see (own
  picks always, others only after kickoff).
- `point_awards` — RLS scopes this to "user is me OR we share a league".

The resulting `accuracy = picksScored / picksMade` mixes those scopes. If
I view a friend's profile from a league we don't share, `picksMade` is 0
and `picksScored` could be >0 from before, giving `NaN%` (well, `0%`
because of the early-return guard). And `picksMade` for friends only
counts picks on past-kickoff matches, while `picksScored` counts every
correct award — so the percentage is mechanically biased upward for any
friend.

**Suggested fix.** Either:

1. Only render the accuracy block on the viewer's own profile, or
2. Compute it server-side via a SECURITY DEFINER RPC that uses the same
   definition of "visible picks" for both numerator and denominator.

Whichever, document the visibility model in `lib/stats/CLAUDE.md` (which
doesn't exist yet — see #10).

---

## 8. P1 — Hand-written `lib/supabase/types.ts` is silently lying

The file's own comment (`lib/supabase/types.ts:1-2`) says "run
`npm run db:types` to regenerate". It hasn't been regenerated, so it
declares foreign-key joins as the joined object directly (e.g.
`home: Team`). PostgREST sometimes returns `T | T[]` depending on how it
infers the relationship cardinality, which has spawned the same casting
incantation in at least seven places:

- `app/(app)/predict/page.tsx:70` (`p.team`)
- `app/(app)/leagues/page.tsx:20` (`m.league`)
- `app/(app)/leagues/actions.ts:97` (`invite.leagues`)
- `app/(app)/match/[id]/page.tsx:30-33` and `:108` (`match.home/away`, `row.profile`)
- `app/(app)/admin/matches/[id]/page.tsx:21-22`
- `app/(app)/leagues/[slug]/page.tsx:150-151`
- `lib/auth/invite.ts:45`

Every cast is `(Array.isArray(x) ? x[0] : x)`. None of them are type-safe;
all of them will silently swallow a future schema change.

**Suggested fix.** Run `npm run db:types` against a real Supabase instance,
commit the result, delete the hand-written file. Then delete every
`Array.isArray` fallback — the regenerated types will tell you the real
cardinality.

---

## 9. P1 — Zero tests on the highest-stakes code paths

There is no test runner configured (no `vitest`/`jest`/`tsx test` in
`package.json`, no `__tests__` directories) despite scoring being:

- The reason the project exists.
- Append-only via `idempotency_key` — wrong awards are sticky.
- Spread across two files that must stay in lockstep
  (`lib/scoring/rules.ts` ↔ `0002_scoring.sql`).

Lock logic likewise has no tests, and the timestamp comparison is the
sole defense between "round 1 picks" and "I cheated by looking at
results".

**Suggested fix (minimum viable).**

1. Add `vitest` as a dev dep and a `test` script.
2. Unit-test `bracketPointsForSlot`, `computeLockState`, `matchIsLocked`
   — these are pure functions and would catch the points-sync drift if
   we ever skew TS vs SQL.
3. A SQL smoke test in `supabase/tests/` that:
   - inserts a fake user + match + prediction,
   - runs `score_match` twice,
   - asserts `point_awards` row count stays 1.
4. Wire `npm test` into `.github/workflows/ci.yml`.

---

## 10. P2 — Documentation drift is already creeping in

A handful of small but corrosive mismatches:

- **Auth callback path.** `app/CLAUDE.md` and the README both say the
  callback lives at `api/auth/callback`. The actual file is
  `app/auth/callback/route.ts`, mapping to `/auth/callback`.
  `lib/auth/signIn.ts:19` is correct; the docs are wrong.
- **CHANGELOG.md is empty.** AGENTS.md mandates one entry per PR; we've
  merged 4 PRs and the file is still pristine. Either enforce in CI or
  delete the convention (and the section in `AGENTS.md`).
- **Table name.** `lib/scoring/CLAUDE.md` refers to "the tournaments
  row" (plural); the actual table is `tournament` (singular,
  single-row).
- **`/login` ignores `?invite=...`.** The login page doesn't read the
  query param; only `/join/[token]` propagates the invite into
  `LoginForm`. Either wire it or remove the dead `inviteToken` prop on
  `LoginForm`.
- **Lock-trigger SQLSTATE.** `enforce_round1_lock` / `enforce_round2_lock`
  raise with `errcode = '40004'` (`0001_init.sql:278, 291`). `40004`
  isn't a defined SQLSTATE; the `40xxx` class is Postgres-reserved for
  transaction-rollback codes. Switch to `P0001` (default for `raise
  exception`) or a custom in the `45xxx` / `H0xxx` private range. This
  also lets server actions branch on a stable code instead of string
  matching.
- **`next.config.ts` is empty.** `components/CountryFlag.tsx` uses
  `unoptimized` to work around the missing `images.remotePatterns`
  allowlist for the football-data CDN. Add the host (e.g.
  `crests.football-data.org`) to `remotePatterns` and drop the
  `unoptimized` flag; we get free CDN/optimization back.

---

## Smaller polish (worth a single grab-bag PR)

- `app/api/cron/sync-fixtures/route.ts:27` and `sync-scorers/route.ts:27`:
  use `crypto.timingSafeEqual` instead of `===`, and dedupe the
  `authorized()` helper into one shared module.
- `lib/admin/actions.ts:74-77`: `overrideMatchResult` accepts arbitrary
  form values; `Number("")` is 0, `Number("abc")` is NaN. Validate the
  numeric inputs server-side and reject non-finite values.
- `0002_scoring.sql`: `player_goal_log` and `player_prop_resolutions` are
  defined *after* `score_tournament()` references them. It works because
  PL/pgSQL doesn't validate body identifiers until call time, but it's
  fragile. Reorder.
- `app/(app)/leagues/page.tsx:32-41`: a separate query to count members
  per league. Replace with a single `select league_id, count(*) ...
  group by league_id`.
- `lib/leagues/actions.ts:30-35`: slug-collision retry loop uses
  `slugify(name)-randomToken(4)` every iteration. The first iteration
  already differs from the base check; consider just emitting
  `slugify(name)-XXXX` from attempt 1 to avoid the wasted lookup.
- `proxy.ts:8-11`: middleware matcher excludes static assets but still
  runs on `/_next/data/...` and on `/api/cron/...`. The cron handlers
  don't need session refresh — exclude `/api/cron` from the matcher.

---

## Things this codebase gets right (worth preserving)

- **Idempotency is real**, not vibes. The `point_awards.idempotency_key`
  unique constraint plus `on conflict do nothing` in every score function
  is genuinely robust against re-runs.
- **RLS is doing the heavy lifting**, not the app layer. The
  `mp_read_after_kickoff` and `bp_read_after_kickoff` policies are the
  right shape — locks are enforced in three independent places (DB
  triggers, RLS, UI), and removing any one would still leave the system
  honest.
- **Server actions return `{ ok, error }` discriminated unions**, with
  matching client-side optimistic-update + rollback patterns
  (`MatchPickCard`, `BracketBuilder`). Good baseline to copy from.
- **The per-directory `CLAUDE.md` system is paying off** — invariants
  live next to the code that has to honor them. Worth keeping in sync
  (see #10).
