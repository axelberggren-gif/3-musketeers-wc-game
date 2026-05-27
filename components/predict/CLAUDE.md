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
- `BracketBuilder.tsx` — Grid of slots grouped by stage (R16 → QF → SF → F → W). Each
  slot is a `<select>` over surviving teams.
- `CountdownBanner.tsx` — Live countdown to first kickoff / knockout lock.
- `PlayerSelect.tsx`, `TeamSelect.tsx` — Generic selectors used in tournament/player
  prop forms. `TeamSelect` supports an optional `showRanking` prop that sorts by
  `fifa_ranking desc` and labels each option `#<rank> — <name>` (used by the
  dark-horse picker so underdogs surface first).
- `NumberInput.tsx` — Integer input with the same optimistic-update-with-rollback
  pattern, used for the total-goals / highest-match-goals tournament guesses.
- `GroupWinnerPicker.tsx` — 12 `TeamSelect`s, one per group (A..L), filtered to that
  group's teams. Each picks the user's predicted group winner.
- `PredictedAdvancers.tsx` — Read-only display of the 32 teams the user's 1X2 picks
  imply will advance to the knockouts (12 winners + 12 runners-up + 8 best 3rds).
  Pure presentational server component; the derivation lives in
  `lib/predictions/advancers.ts`. Renders an empty state until the user makes their
  first pick. Surfaces tiebreaker badges (`H2H` / `FIFA` / `Tied`) when standings
  weren't decidable on points alone.
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
  `R16 → QF → SF → F → W` regardless of how the parent orders them.

## Recent changes
<!-- Newest first. Keep last 10. One line per entry. -->
- 2026-05-27: New `PredictedAdvancers.tsx` server component renders the read-only "Predicted advancers" section on `/predict` (12 group winners + 12 runners-up + 8 best 3rds derived from the user's 1X2 picks). Pure presentational; derivation lives in `lib/predictions/advancers.ts`. Tiebreaker chips (H2H / FIFA / Tied) surface when standings weren't decidable on points alone. Refreshes on Server Component re-render only — `setMatchPick` already revalidates `/predict`.
- 2026-05-25: `CountdownBanner` no longer triggers React hydration mismatches. The lazy `useState` initializer used to call `Date.now()` during SSR, but SSR and hydration run a few hundred ms apart so the formatted string differed and React tore the DOM. `remaining` now starts as `null` (placeholder DOM `--:--:--` on both server and client first render); a `requestAnimationFrame` inside `useEffect` schedules the first real tick, then a 1 s interval drives the countdown. Refs Sentry `JAVASCRIPT-NEXTJS-5` / #47.
- 2026-05-22: Sticker Stadium re-skin. `MatchPickCard` rebuilt with sticker tiles (paper-2 bg, ink shadow, gold selection state) and a "✓ Picked / Pick! / Locked" status pill. Tile tap now toggles (re-tap clears the pick). `BracketBuilder` slots use a dashed-border "?" empty state, gold shadow on the Champion slot when filled, sticker stage headers. `CountdownBanner` rebuilt as a coral-shadow sticker pill with mono `LOCKS IN` label + Archivo Black coral countdown. `TeamSelect` / `PlayerSelect` / `NumberInput` / `GroupWinnerPicker` / `TournamentForm` inherit the new `.input` + `.label` chrome with no behaviour changes. Bracket progressive-reveal (R16 pre-set, QF/SF/F derive from upstream, downstream invalidation) is **not** implemented — tracked in `/DESIGN_MISALIGNMENTS.md` §7.
- 2026-05-22: Added `NumberInput.tsx` and `GroupWinnerPicker.tsx` for the new tournament-wide props (total goals, highest match, group winners). `TeamSelect` gained `showRanking` for rank-based dark-horse display. `TournamentForm` extended with first-eliminated, total-goals, highest-match, troublemaker fields plus the rank-aware dark-horse label.
