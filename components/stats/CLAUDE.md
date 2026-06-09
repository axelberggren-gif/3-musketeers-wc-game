> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# components/stats/ — profile stats visualisations

## Purpose
Read-only stat visualisations rendered on `/profile/[username]`. The aggregation lives in
`lib/stats/`; components here are pure presentation.

## Key files
- `PickPersonality.tsx` — the **Pick personality** card (`DESIGN_MISALIGNMENTS.md` §4). A
  **plain server component** (no `"use client"` — no state/effects/interactivity) taking a
  single `{ data: PickPersonality }` prop from `loadPickPersonality()`. Renders a stacked
  H/D/A pick-mix bar, three "you vs league average" comparison bars (Group accuracy /
  Knockout accuracy / Bracket survival — a solid user fill over a hatched
  `repeating-linear-gradient` league-average ghost track), and three secondary tiles
  (Boldness %, Avg pick time, Upsets called). Hand-rolled bars (div widths in `%`), all
  colours from `globals.css` tokens — **no chart library**. Currently the directory's
  only component.

## Conventions
- **Server-rendered + presentational.** Take fully-aggregated, plain-serialisable props
  (numbers / nullable numbers / small objects) — never a `Map`/`Set` across the boundary,
  never a Supabase client. All fetching + math lives in `lib/stats/` (see its `CLAUDE.md`).
- Sticker Stadium styling only: `.card`, `.badge`/`badge-gold`, `font-display`,
  `font-mono-sticker`, and the `var(--gold|pitch|coral|mag|ink|ink-soft)` tokens +
  `bg-paper-2`. No inline colour literals; no magic point numbers (copy is descriptive).
- Degrade gracefully: every sub-stat is nullable. Missing data renders `—` / "Not enough
  data yet" / "No picks yet", never `NaN` or an empty bar.

## Invariants (do not break)
- The card is **read-only** — no server actions, no inputs. RLS is the source of truth for
  what data the viewer sees; the component just renders whatever the loader returns.
- `PickPersonality` props shape mirrors the `PickPersonality` type exported from
  `lib/stats/personality.ts`. Change the type and the component together.

## Known gotchas
- `loadPickPersonality()` returns `null` when nothing is visible to the viewer, so the
  profile page renders the card with `{personality && <PickPersonality … />}`. The
  component itself assumes `data` is present.
- The hatched league-average track is a `repeating-linear-gradient(45deg, var(--ink-soft)
  0 2px, transparent 2px 7px)` over `var(--paper-2)`, with the solid user fill at a higher
  `z-index` so the two never visually merge (mirrors the `.pitch-stripes` idiom).

## Recent changes
- 2026-06-09: Deleted `AccuracyChart.tsx` (and the `recharts` dependency, alongside four
  other unused deps repo-wide). The per-MD cumulative-points line chart was rejected
  ("per-MD doesn't apply — all predictions lock at tournament start"), rendered nowhere,
  and used stale legacy tokens. `PickPersonality.tsx` is now the directory's only
  component; the hand-rolled-bars / no-chart-library convention stands.
- 2026-06-09: `PickPersonality.tsx` bracket-survival hint reads `played {N} KO` (was `won {N} KO`) — `userSample` is the champion's games played, not won (follow-up to #120 review).
- 2026-06-09: Created `PickPersonality.tsx` for `DESIGN_MISALIGNMENTS.md` §4 — replaces the
  profile-page placeholder. Backed by the new `lib/stats/personality.ts` aggregator +
  migration `0026_reveal_group_picks_at_round1_lock.sql` (cohort data from group-stage
  start). Server component, hand-rolled bars, no recharts. `AccuracyChart.tsx` left
  orphaned (deletion candidate).
