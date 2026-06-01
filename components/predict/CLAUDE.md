> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# components/predict/ — prediction UI (client components)

## Purpose
Client components for the round-1 (1X2 picks) and round-2 (knockout bracket) prediction
screens, plus supporting selectors. All components here are interactive and run in the
browser — server data is passed in as props from the matching `app/(app)/predict/*`
server pages.

## Key files
- `MatchPickCard.tsx` — One match, three big tiles (Home/Draw/Away). Optimistic update
  via `useTransition`, rolls back on server-action failure.
- `BracketBuilder.tsx` — Grid of slots grouped by stage (R32 → R16 → QF → SF → F → W).
  Each slot is a `<select>` filtered by progressive reveal: R32 shows all teams; R16/QF/SF/F
  show only the winners picked in the two upstream slots (via `BRACKET_UPSTREAM` from
  `lib/scoring/bracket-tree.ts`); W shows only the F pick. Upstream change cascades
  through `clearBracketPicks()` to wipe downstream picks the new winners no longer cover.
  Owns picks state locally for the optimistic UX. Renders a "Suggest qualifiers" button
  when `r32Suggestions` is non-empty and any R32 slot is unfilled — calls
  `setBracketPicksBulk()` to fill empty R32 slots only (never overwrites).
- `CountdownBanner.tsx` — Live countdown to first kickoff / knockout lock.
- `PlayerSelect.tsx`, `TeamSelect.tsx` — Generic selectors used in tournament/player
  prop forms. `TeamSelect` supports an optional `showRanking` prop that sorts by
  `fifa_ranking desc` and labels each option `#<rank> — <name>` (used by the
  dark-horse picker so underdogs surface first).
- `NumberInput.tsx` — Integer input with the same optimistic-update-with-rollback
  pattern, used for the total-goals / highest-match-goals tournament guesses.
- `GroupWinnerPicker.tsx` — 12 `TeamSelect`s, one per group (A..L), filtered to that
  group's teams. Each picks the user's predicted group winner.
- `GroupStageList.tsx` — Owns the group-stage 1X2 match list on `/predict`. Renders
  a sticker filter strip (an "All groups" reset pill + one pill per group letter)
  then re-groups the visible matches by date for the existing date-banner layout.
  Active group lives in local `useState<string | null>`; clicking a group toggles
  it (re-tap clears, tapping a different group switches). Receives plain-object
  props (`Record<>` not `Map`) so React Server Component → Client Component
  serialisation works.
- `TournamentForm.tsx` — Admin form for tournament key dates.

## Conventions
- Every file starts with `"use client"`. Persistence is via server actions imported
  from `lib/predictions/actions.ts` (and `lib/admin/actions.ts` for admin forms).
- **Optimistic updates with rollback**: set state immediately, call server action in
  `startTransition`, restore previous state on `!result.ok`. Pattern is in
  `MatchPickCard.tsx:choose()` and `BracketBuilder.tsx:handleChange()` — copy it for
  new picker components.
- `locked` is a prop, not derived in the component. The server page computes it via
  `computeLockState()` from `lib/scoring/lock.ts` and passes it in.
- Tailwind v4 utility classes + CSS variables (`var(--accent)`, `var(--surface-2)`,
  etc.) for theming. No inline color literals.

## Invariants (do not break)
- When `locked` is true, all inputs MUST be disabled. The DB also enforces this via
  lock triggers, but a non-disabled UI is a bug.
- Pick state shape mirrors `Pick1X2` from `lib/supabase/types.ts`. If the enum
  changes, regenerate types and update components.
- Server actions return `{ ok: true } | { ok: false; error: string }`. UI must
  handle both branches — never assume success.

## Known gotchas
- `MatchPickCard` shows a "Locked" badge using the same prop that disables tiles —
  don't compute lock state twice.
- `BracketBuilder` groups slots by `stage` and renders them in a fixed order
  `R32 → R16 → QF → SF → F → W` regardless of how the parent orders them. The grid
  uses `lg:grid-cols-6` to fit all six stage columns side-by-side; mobile / `sm`
  stacks them.
- Progressive reveal: when a R32 slot's pick changes, the cascade computes which
  downstream picks reference winners that no longer match. Those slots are nulled
  in local state and DELETE'd via `clearBracketPicks()` after the upstream upsert
  succeeds. If `setBracketPick` fails, the original picks are restored and the
  cascade is skipped — never partial writes.

## Recent changes
<!-- Newest first. Keep last 10. One line per entry. -->
- 2026-06-01: `MatchPickCard` re-tap-to-clear now actually clears the pick in the DB. `choose()` sent `next ?? value` to `setMatchPick`, so toggling a tile off cleared the UI optimistically but re-saved the original pick server-side (the action only upserted) and it reappeared on next load — contradicting the documented "re-tap clears the pick" behaviour. Now passes `next` (which is `null` on re-tap); `setMatchPick` accepts `Pick1X2 | null` and DELETEs the `match_predictions` row on null (mirrors `setGroupWinnerPick`). Rollback-on-failure unchanged.
- 2026-05-27: `BracketBuilder` filters `r32Suggestions` through the actual `slots` prop before counting / applying — defense in depth after the helper started returning at most 16 picks. `validSuggestions` is the only thing the button reads, so a future helper bug that emits an out-of-range slot can never write an orphan row. Suggestion explainer copy updated to "16 likely R32 winners (top advancers by predicted points)" — was misleadingly "32 qualifiers".
- 2026-05-27: `BracketBuilder` extended for WC 2026's Round of 32. Stage union gains `R32`; `STAGE_ORDER` is now `R32 → R16 → QF → SF → F → W`. Grid bumped to `lg:grid-cols-6`. Each slot now filters its `<select>` options through `BRACKET_UPSTREAM` (from `lib/scoring/bracket-tree.ts`): R32 shows all 48 teams; downstream stages restrict to winners picked upstream. Picks are owned in component state (was: per-slot state); changing an upstream slot computes the set of invalidated downstream picks and clears them via `clearBracketPicks()` after the primary `setBracketPick()` succeeds. New "Suggest qualifiers" pitch-green pill above the grid: when the server passes `r32Suggestions` (top-2 per group + best-8 third-place, computed from the user's group-stage 1X2 picks), one click bulk-upserts via `setBracketPicksBulk()` into empty R32 slots only. Server action `clearBracketPicks(slots[])` and `setBracketPicksBulk(picks[])` added to `lib/predictions/actions.ts` — both gated on `locks.round2Locked`.
- 2026-05-25: `GroupStageList.tsx` extracted from `app/(app)/predict/page.tsx`. The static group chip strip became an interactive filter: an "All groups" reset pill plus one pill per group letter; clicking toggles the active filter (re-tap clears, switch to a different group switches). Active pill uses `bg-gold`; complete groups still flip to `bg-pitch` ✓ when inactive. Date-grouping moved into the client component so it re-groups the filtered subset. Server page now passes `picksByMatch` / `groupCoverage` as plain `Record<>` objects (was `Map`) for RSC serialisation.
- 2026-05-25: `CountdownBanner` no longer triggers React hydration mismatches. The lazy `useState` initializer used to call `Date.now()` during SSR, but SSR and hydration run a few hundred ms apart so the formatted string differed and React tore the DOM. `remaining` now starts as `null` (placeholder DOM `--:--:--` on both server and client first render); a `requestAnimationFrame` inside `useEffect` schedules the first real tick, then a 1 s interval drives the countdown. Refs Sentry `JAVASCRIPT-NEXTJS-5` / #47.
- 2026-05-22: Sticker Stadium re-skin. `MatchPickCard` rebuilt with sticker tiles (paper-2 bg, ink shadow, gold selection state) and a "✓ Picked / Pick! / Locked" status pill. Tile tap now toggles (re-tap clears the pick). `BracketBuilder` slots use a dashed-border "?" empty state, gold shadow on the Champion slot when filled, sticker stage headers. `CountdownBanner` rebuilt as a coral-shadow sticker pill with mono `LOCKS IN` label + Archivo Black coral countdown. `TeamSelect` / `PlayerSelect` / `NumberInput` / `GroupWinnerPicker` / `TournamentForm` inherit the new `.input` + `.label` chrome with no behaviour changes. Bracket progressive-reveal (R16 pre-set, QF/SF/F derive from upstream, downstream invalidation) is **not** implemented — tracked in `/DESIGN_MISALIGNMENTS.md` §7.
- 2026-05-22: Added `NumberInput.tsx` and `GroupWinnerPicker.tsx` for the new tournament-wide props (total goals, highest match, group winners). `TeamSelect` gained `showRanking` for rank-based dark-horse display. `TournamentForm` extended with first-eliminated, total-goals, highest-match, troublemaker fields plus the rank-aware dark-horse label.
