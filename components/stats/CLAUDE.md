> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# components/stats/ — read-only stats UI

## Purpose
Client components that render aggregations from `lib/stats/*`. Pure presentation
— no server actions, no mutation. Server pages compute the data and pass it in
as already-shaped props.

## Key files
- `PulseTabs.tsx` — League/Tournament toggle for the leaderboard Pulse panel.
  Holds the active-mode `useState`; renders one tile-grid (4 tiles) + one
  highlight stack (3 rows) for the active mode. Both `LeaguePulse` and
  `TournamentPulse` arrive pre-computed from `lib/stats/pulse.ts` so the toggle
  never re-fetches — switching modes is a pure local state flip.
- `AccuracyChart.tsx` — Legacy points-over-time line chart. Used to live on the
  profile page; currently unrendered (per the per-MD accuracy rejection) but
  kept around in case the Pick personality work needs it.

## Conventions
- Every file starts with `"use client"`. Persistence belongs in server actions,
  not here.
- Receive pre-shaped data as props. `PulseTile` and `PulseHighlight` from
  `lib/stats/pulse.ts` are the contract; never reshape inside the component.
- Sticker Stadium chrome — `border-2 border-ink`, `box-shadow: 3px 3px 0 var(--ink)`,
  Archivo Black headings, mono-sticker labels. No inline colour literals.

## Invariants (do not break)
- The Pulse data contract is `{ tiles: PulseTile[]; highlights: PulseHighlight[] }`
  for both modes. If the renderer needs new fields, add them to the types in
  `lib/stats/pulse.ts` first; the renderer stays dumb.
- The tab toggle MUST NOT trigger a network round-trip. Both modes' data is
  prefetched server-side so the panel feels instant.

## Known gotchas
- The Pulse panel renders below `LeaderboardLive`, which subscribes to
  `point_awards` realtime. The panel does NOT auto-refresh on those events —
  that's intentional (Pulse aggregates would thrash on every score). The next
  full navigation reloads the panel; if a finer freshness story is needed,
  wire `unstable_cache` per `loadTournamentPulse` invalidated by a
  finished-match-count tag.

## Recent changes
- 2026-05-26: Created `PulseTabs.tsx` for the Pulse panel (#37). Renders the
  League/Tournament toggle plus 4 tiles + 3 highlights per mode from the new
  `lib/stats/pulse.ts` loaders. Mounted under `LeaderboardLive` in
  `app/(app)/leagues/[slug]/leaderboard/page.tsx`.
