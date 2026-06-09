> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# components/league-bets/ — internal league bets UI (client + presentational)

## Purpose
UI for the two per-league social side bets settled when the group stage ends:
**crown** 👑 (vote who tops the group stage) and **wooden spoon** 💩 (vote who finishes
bottom). Mounted in two places — the league home page (`app/(app)/leagues/[slug]/page.tsx`)
and the bottom of the Outcomes tab (`components/predict/OutcomesBoard.tsx`'s last zone) —
plus tally badges on the leaderboard. Backed by `lib/league-bets/` and the
`league_group_bets` table + `score_league_group_bets()` scorer from migration
`0023_league_internal_bets.sql`.

## Key files
- `LeagueBetsCard.tsx` — `"use client"`. One league's two bets: a crown tile + a wooden-spoon
  tile, each a `LeagueMemberSelect` (self excluded from the options). Optimistic save via
  `setLeagueBet(leagueId, kind, voteeId, pathname)` — `usePathname()` is passed so the
  action can revalidate whichever page hosts the card. When `locked` and `tallies` are
  present it also renders a "The votes are in" summary (`TallyList`). Takes `leagueName`
  (shown only when several leagues stack, e.g. the Outcomes tab).
- `LeagueMemberSelect.tsx` — `"use client"`. Generic "pick a league member" `<select>`,
  same optimistic-update-with-rollback pattern as `components/predict/TeamSelect.tsx`
  (optional `label`).
- `VoteBadges.tsx` — **presentational, no `"use client"`** (no hooks, so it renders in both
  server pages and client components). Renders the `👑 N` / `💩 N` cluster for one member;
  returns `null` when both counts are 0.

## Conventions
- Persistence is the single server action `setLeagueBet` in `lib/league-bets/actions.ts`;
  shared constants (`BET_KINDS`, `BET_EMOJI`, `VoteTally`) live in `lib/league-bets/shared.ts`
  (IO-free, import from both client + server).
- `locked` is a prop (the page computes `computeLockState(...).round1Locked`), never derived
  here. Votes lock at first kickoff, like all round-1 picks.
- Optimistic updates with rollback in the selector; the DB is the real gate (RLS +
  `enforce_round1_lock` trigger). Server actions return `{ ok } | { ok:false, error }`.
- Tailwind v4 utilities + `globals.css` tokens (`var(--gold)`, `var(--coral)`, `var(--mag)`,
  `bg-paper-2`, `border-ink`). No inline colour literals beyond the token vars.

## Invariants (do not break)
- **Tallies are hidden until round 1 locks.** The mounting page passes `tallies = null`
  (or an empty map) before lock, so no badges/summary leak who voted for whom. RLS
  (`lgb_read_after_lock`) enforces the same server-side.
- **Self is never a votee option.** Three aligned layers: `LeagueBetsCard` filters
  `selfId` out of the select, the `setLeagueBet` action rejects a self-vote, and — since
  migration `0030_lock_deletes_and_self_vote.sql` — the `lgb_write_self` RLS policy
  enforces `votee_id <> auth.uid()` at the DB. Change one, change all three.
- **No magic point numbers in logic** — point copy in the tiles is descriptive text;
  actual values live in `lib/scoring/rules.ts` `POINTS.leagueBet` + the SQL twins.

## Known gotchas
- `VoteBadges` must stay hook-free so it can render inside the server-rendered league
  page Top-5 **and** the `"use client"` `LeaderboardLive` rows.
- Tallies are static after lock (votes are locked), so `LeaderboardLive` takes them as a
  plain prop — no extra realtime subscription (the existing `point_awards` channel already
  refreshes standings when the scorer awards points).
- A user in multiple leagues sees one `LeagueBetsCard` per league on the Outcomes tab;
  the league page shows only that league's card.

## Recent changes
- 2026-06-09: Self-votes are now rejected at the DB, not just in the action. Migration
  `0030_lock_deletes_and_self_vote.sql` recreates `lgb_write_self` verbatim from 0023 plus
  `votee_id <> auth.uid()` in WITH CHECK, closing the gap (a PR #108 post-merge review
  blocker) where a hand-crafted PostgREST write could vote for yourself — `setLeagueBet`
  already blocked it, the policy didn't. The same migration makes the `league_group_bets`
  round-1 lock trigger fire on DELETE too (with a privileged-role bypass so
  `removeLeagueMember`'s service-role vote cleanup still works post-lock). No UI change.
- 2026-06-08: initial internal-league-bets UI (crown 👑 + wooden spoon 💩). New
  `LeagueBetsCard` / `LeagueMemberSelect` / `VoteBadges`; mounted on the league page (Top-5
  badges + voting section), the leaderboard rows (badges), and a new "Internal league bets"
  zone in `OutcomesBoard`. Backed by `lib/league-bets/` + migration `0023`.
