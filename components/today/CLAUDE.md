> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# components/today/ — the /today matchday start page UI

## Purpose
UI for the league-centric **Today** start page (`app/(app)/today/page.tsx`) — the
app's post-login landing surface during the tournament. Today's matches with every
league member's revealed 1X2 call per match, the next/previous slates, the league
switcher, and the "League pulse" stats strip (twins & opposites, form guide). The
banter sidebar is the shared `components/banter/BanterFeed` (not duplicated here);
data comes from `lib/stats/group-picks.ts` + `lib/stats/league-pulse.ts` +
`lib/banter/load.ts`.

## Key files
- `TodayBoard.tsx` — `"use client"`. Buckets the group-stage matches into Today /
  next slate / previous slate by **viewer-local calendar day**. Today's matches are
  hero cards: group badge + kickoff (`LocalKickoff`) + LIVE/Final/Upcoming badge,
  flags + score linking to `/match/[id]`, a `PickSplitBar` ("4 CAN · 3 draw · 2 BIH"
  segmented gold/white/coral bar) and a member grid — one row per league member
  (viewer pinned first, gold) with their `PickChip` (✓/✗ once decided). Yesterday /
  tomorrow render as compact `MatchScoreline` rows with the viewer's chip + a
  `h·d·a` mini tally. Pre-round-1-lock the member grid is replaced by a "picks
  reveal at first kickoff" note (`revealed` prop).
- `LeagueSwitcher.tsx` — `"use client"`. Pill toggle between the viewer's leagues
  (`router.push("/today?league=<slug>")` in a transition). Mounted only when the
  viewer is in >1 league; a single league renders a static league-name badge in the
  page instead.
- `LeaguePulse.tsx` — **hook-free server component**. Two cards from plain props:
  **Twins & opposites** (you vs every league-mate, `same/both` counts, "Your twin" /
  "Your opposite" badges on the extremes, rows deep-link to `/compare?b=<username>`)
  and **Form guide** (each member's last-5 decided picks as ✓/✗ dots + a 🔥/🧊 badge
  on the league's hottest/coldest active streak ≥2).

## Conventions
- Day bucketing is timezone-sensitive → hydration-safe pattern (Sentry
  `JAVASCRIPT-NEXTJS-5`): SSR + first client render bucket by the kickoff ISO's UTC
  date with a `serverNowIso` anchor; a rAF effect re-buckets in the viewer's local
  timezone after mount. `suppressHydrationWarning` on day labels.
- Pure math lives in `lib/stats/league-pulse.ts` / `lib/stats/picks-shared.ts`
  (IO-free, client-safe — **never** import `lib/stats/group-picks.ts` here, it pulls
  in the server-only Supabase client). The page computes pulse rows server-side.
- Sticker Stadium styling only — `globals.css` tokens, no inline colour literals,
  no magic point numbers.

## Invariants (do not break)
- **RLS is the reveal gate** (same rule as `components/picks/`): render only what the
  page's RLS-scoped fetch returned; never service-role. The `revealed` prop
  (`computeLockState(...).round1Locked`, computed by the page) additionally hides
  member grids/tallies pre-lock so a lone self-pick doesn't masquerade as a tally.
- `LeaguePulse` must stay hook-free so it server-renders; `TodayBoard` owns all
  client state.
- Member/agreement rows only ever cover the active league's members — the only
  people RLS can reveal AND the cohort the copy claims ("the league split").

## Known gotchas
- "No visible pick" vs "no pick made" are indistinguishable (RLS hides rows);
  `PickChip` renders both as "No pick" — fine post-lock since hidden = not made.
- A FINISHED match with `winner = null` (football-data lag) counts as pending —
  chips stay neutral, form dots exclude it (`pickOutcome` contract).
- Post-mount re-bucketing can visibly shift a late-night match between Today and
  Tomorrow for non-UTC viewers — intentional, that's the local-timezone correction.

## Recent changes
- 2026-06-12: Created for the Today start page: `TodayBoard`, `LeagueSwitcher`,
  `LeaguePulse`. Pure math in `lib/stats/league-pulse.ts`; pick helpers split into
  client-safe `lib/stats/picks-shared.ts`; banter bootstrap shared via
  `lib/banter/load.ts`.
