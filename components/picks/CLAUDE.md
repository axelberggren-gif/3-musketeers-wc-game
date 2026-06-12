> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# components/picks/ — public group-stage pick display (profile board + compare)

## Purpose
Presentational building blocks for showing **revealed** group-stage 1X2 picks: the
per-group picks board on `/profile/[username]` and the side-by-side head-to-head on
`/compare`. Read-only display of locked picks — nothing here edits a prediction
(that's `components/predict/`). Data comes from `lib/stats/group-picks.ts`.

## Key files
- `PickChip.tsx` — **hook-free** sticker chip for one user's call on one match: picked
  team's 3-letter code (or "Draw"), pitch-green ✓ when correct, coral ✗ when wrong,
  neutral paper while pending, muted "No pick" when `pick` is null. Outcome comes in as
  a prop (`pickOutcome()` runs server-side).
- `MatchScoreline.tsx` — **hook-free** compact `flags + codes + score/vs` block for one
  group match, linking to `/match/[id]`. Shows the live scoreline in coral while a
  match is LIVE.
- `ComparePlayerSelect.tsx` — `"use client"`. The `/compare` slot swapper: a labelled
  `<select>` of the viewer's league-mates that `router.push`es the updated
  `/compare?a=&b=` query (in a `useTransition`, select disabled while pending). If the
  URL holds a username outside the options (deep link), it's prepended so the control
  reflects reality.

## Conventions
- `PickChip` / `MatchScoreline` must stay **hook-free** (no `"use client"`) so they
  render inside server pages and client components alike — same rule as
  `components/league-bets/VoteBadges.tsx`.
- Outcomes/tallies are computed server-side with the pure helpers in
  `lib/stats/group-picks.ts` (`pickOutcome`, `tallyPickRecord`) and passed down as
  props. No fetching, no Supabase clients in here.
- Sticker Stadium styling only: `globals.css` tokens (`bg-pitch`, `bg-coral`,
  `bg-paper-2`, `border-ink`, `.input`, `.label`, `font-display`,
  `font-mono-sticker`). No inline colour literals, no magic point numbers (the
  profile board's `+3` renders `POINTS.match1x2`).

## Invariants (do not break)
- **RLS is the reveal gate.** These components render whatever the server page's
  RLS-scoped fetch returned — never add a service-role fetch to "fill in" hidden
  picks. Before round-1 lock another user's picks are simply absent
  (`mp_read_after_lock`, migration 0026) and the hosting pages hide/replace the board.
- `ComparePlayerSelect`'s options must stay limited to the viewer's league-mates
  (+ the viewer) — those are the only people whose picks RLS can reveal, so anything
  broader produces an all-dashes column.

## Known gotchas
- "No visible pick" and "no pick made" are indistinguishable to a viewer (RLS hides
  rows, it doesn't mark them). `/compare` shows a one-line explainer when a side has
  zero visible picks; don't present dashes as a confirmed abstention.
- A FINISHED match can briefly have `winner = null` (football-data lag) — `pickOutcome`
  returns `pending` then, so chips stay neutral instead of flashing wrong colours.

## Recent changes
- 2026-06-12: `PickChip` + `MatchScoreline` are now also rendered by the `/today`
  start page (`components/today/TodayBoard.tsx` — member pick grids + compact day
  rows). Their type imports resolve via the client-safe `lib/stats/picks-shared.ts`
  split (re-exported from `group-picks.ts`); no component changes.
- 2026-06-12: Created for the public group-stage picks feature: `PickChip`,
  `MatchScoreline`, `ComparePlayerSelect`. Used by the new full picks board on
  `/profile/[username]` (replacing the 10-row "Recent picks" list) and the new
  `/compare` head-to-head page. Loader + pure helpers in `lib/stats/group-picks.ts`.
