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
- `BracketBuilder.tsx` — **"The Wall Chart"**: a symmetric tournament poster (left draw
  flows right, right draw flows left, Final + Champion crown the centre) drawn with
  measured SVG elbow connectors. Cells are tagged `data-slot`; a `measure()` callback
  (run in an effect on rAF / `ResizeObserver` / `document.fonts.ready`, never during
  render) reads their boxes via `localBox()` (an offset-chain immune to scroll) and
  builds the connector paths. Two lifecycle modes, derived from the `locked` prop:
  - **build** (`!locked`) — editable. Each slot is a `MatchCell` with two stacked
    team-lines: click a line to advance that team. A slot is pickable only when **both**
    contestants are known (top-down fill); an undecided downstream feeder renders
    `Winner of Quarter-final 1` (`slotFriendlyName()` names the feeding round, no longer
    recursive team codes). **R32 entry cells are group-qualification matchups, not a
    dropdown**: each side is an official WC 2026 qualification slot from `R32_QUALIFIERS`
    (Winner / Runner-up / 3rd of a group) and shows the placeholder label
    (`Runner-up Group K`, `3rd Group A/B/C/D/F`) until that side resolves to a real
    team **from the imported real fixture only** (`slotMatches[slot]`, which now
    records a slot as soon as **either** side has a team, and is read per-side).
    The team is **never guessed from group standings** — the old `groupFinals` /
    `computeGroupFinals()` resolution path was removed because `R32_QUALIFIERS`' slot
    numbering follows FIFA's "Matches 73–88" order while `deriveBracketSlot()` assigns
    `bracket_slot` by kickoff order; the two don't line up, so guessing dropped a team
    into the wrong slot and duplicated one already placed by the real fixture (the
    NED/MAR-in-two-slots bug). You tap the winner once both sides are real teams, same
    as every downstream cell. Team-lines display the 3-letter `code` + flag. The Champion (`W`)
    is a crown-sticker: tap to crown the Final winner, which sets the real `W` pick (+15).
  - **live** (`locked`) — read-only + scored from the `results` prop
    (`{winnerTeamId, homeScore, awayScore, status}` per slot; `W` ← the Final result).
    A FINISHED slot banks its points (green ✓ Won + scoreline footer + `+pts`) or strikes
    your pick (red, grayscale, `+0`); busted downstream picks persist and grey out. The
    champion sticker flips to "✗ Not your call" on a missed final. A `PointsHUD` shows
    banked `/85` + per-stage hit rate; connectors turn green (correct) / red-dashed
    (wrong).
  Upstream change cascades through `clearBracketPicks()` to wipe now-orphaned downstream
  picks (optimistic, rollback on failure). Flags use `CountryFlag` (crest → code-box
  fallback), not emoji. Desktop (`lg+`) fits the `max-w-6xl` page width (no horizontal
  scroll); below `lg` the chart keeps a generous `72rem` min-width floor
  (`min-w-[72rem] lg:min-w-0`) so cells stay full-size and the whole poster
  side-scrolls on phones/tablets — we'd rather scroll a long way than squash teams
  into illegible slivers. Height is `clamp(720px, 80vh, 800px)` so the 8 stacked R32
  cells per column keep real spacing on small screens.
  Point values come from `bracketPointsForSlot()` / `POINTS.bracket` — no magic numbers.
- `BooleanSelect.tsx`, `MatchSelect.tsx` — Yes/No and match-dropdown selectors
  (same optional-`label` + optimistic-rollback contract as `TeamSelect`). Added for
  the admin-resolved "house special" props on the Outcomes board (Neymar/streaker
  Yes/No; the war-game group-match picker, whose options are labelled server-side).
- `CountdownBanner.tsx` — Live countdown to first kickoff / knockout lock.
- `OutcomesBoard.tsx` — **The "betting slip"**: the whole `/predict/outcomes` page
  body. Composes the optimistic selectors into a `PropCard` sticker for each
  tournament-wide prop, grouped into themed zones (The big calls · Boots & bookings ·
  The numbers game · Wildcards).
  A flat `filled` map (every pick key → bool, seeded from the server props) drives a live
  completion meter; each selector's `onSave` is wrapped so a successful save flips the
  meter bit (the selectors still own the optimistic rollback). `PropCard` is local +
  presentational (icon, title, points badge, hint, accent shadow, ✓/— footer; the
  champion card gets the `.holo` foil). No magic point numbers shown — labels are copy.
- `PlayerSelect.tsx` — Searchable, filterable **player combobox** (the ~1,100-player WC
  catalogue made a flat `<select>` unusable). A trigger field opens a sticker popover
  with a search box (name **or** country), DEF/MID/ATT/GK position pills, and a country
  dropdown; results are flag-decorated (`CountryFlag`), AND-filtered, and capped at 100.
  Same optimistic `onSave` rollback contract as before; `label` optional. `PlayerOption`
  carries optional `position` / `team_code` / `team_crest`. Position bucketing lives in
  the pure `lib/players/position.ts`.
- `TeamSelect.tsx` — Generic team selector (native `<select>`). `label` is **optional**
  (omit it when a wrapper like `PropCard` owns the title). Optional `showRanking` prop
  sorts by `fifa_ranking desc` and labels each option `#<rank> — <name>` (used by the
  dark-horse picker so underdogs surface first).
- `NumberInput.tsx` — Integer input with the same optimistic-update-with-rollback
  pattern (optional `label`; `max` is **optional** — omit for an unbounded input that
  enforces only the `min` floor and shows a `{min}+` placeholder, e.g. Total goals),
  used for the over-under tournament guesses.
- `GroupStageList.tsx` — Owns the group-stage 1X2 match list on `/predict`. Renders
  a sticker filter strip (an "All groups" reset pill + one pill per group letter)
  then re-groups the visible matches by date for the existing date-banner layout.
  Active group lives in local `useState<string | null>`; clicking a group toggles
  it (re-tap clears, tapping a different group switches). Receives plain-object
  props (`Record<>` not `Map`) so React Server Component → Client Component
  serialisation works.
- (`TournamentForm.tsx` removed 2026-06-08 — superseded by `OutcomesBoard.tsx`. The
  unrelated admin key-dates form lives at `app/(app)/admin/tournament/TournamentForm.tsx`.)

## Conventions
- Every file starts with `"use client"`. Persistence is via server actions imported
  from `lib/predictions/actions.ts` (and `lib/admin/actions.ts` for admin forms).
- **Optimistic updates with rollback**: set state immediately, call server action in
  `startTransition`, restore previous state on `!result.ok`. Pattern is in
  `MatchPickCard.tsx:choose()` and `BracketBuilder.tsx:applyPick()` — copy it for
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
- `BracketBuilder` lays the slots out as a fixed symmetric poster: `LEFT` half
  (`R32-1..8 → R16-1..4 → QF-A,B → SF-A`) and a mirrored `RIGHT` half
  (`SF-B → QF-C,D → R16-5..8 → R32-9..16`) flanking a centre `Final + Champion`
  column. Columns are equal-height with `justify-content: space-around` so each
  downstream cell lands centred between its two feeders (the bracket "funnel"); the
  `LEFT` / `RIGHT` maps are local constants, not derived from the `slots` prop order.
  Connectors are SVG paths measured from real DOM boxes, so they stay correct as the
  columns flex to fit the container width.
- The chart fits `max-w-6xl` on desktop (`lg+`) with **no** horizontal scroll
  (`lg:min-w-0` releases the floor so `w-full` fills the container); below `lg` an
  `overflow-x-auto` wrapper + a `min-w-[72rem]` floor make the full-size poster
  side-scroll on phones/tablets. Height is `clamp(720px, 80vh, 800px)` (was a
  too-short `clamp(600px, 74vh, 720px)`, which crushed the 8 R32 cells per column on
  mobile). The `W` champion connector is intentionally not drawn — the sticker sits
  directly under the Final.
- Progressive reveal: when a R32 slot's pick changes, the cascade computes which
  downstream picks reference winners that no longer match. Those slots are nulled
  in local state and DELETE'd via `clearBracketPicks()` after the upstream upsert
  succeeds. If `setBracketPick` fails, the original picks are restored and the
  cascade is skipped — never partial writes.

## Recent changes
<!-- Newest first. Keep last 10. One line per entry. -->
- 2026-06-27: `BracketBuilder` R32 entry cells now resolve **only** from the authoritative imported fixture, per side — fixing the same team showing in two R32 slots (the NED/MAR duplication). Previously a side could be resolved either from `slotMatches` (used only when **both** sides had a team) or, as a fallback, *guessed* from `R32_QUALIFIERS` + the `groupFinals`/`computeGroupFinals()` path. That guess is unsafe: `R32_QUALIFIERS`' slot numbering follows FIFA's "Matches 73–88" order while `deriveBracketSlot()` assigns `bracket_slot` by kickoff order, so they don't line up — a half-resolved real fixture (one side TBD → excluded from `slotMatches`) fell back to the mis-aligned guess and placed a team in the wrong slot, duplicating one the real fixture had already placed elsewhere (and `computeGroupFinals()` has no head-to-head tiebreak, so it can disagree with football-data outright). Now: `slotMatches` records a slot as soon as **either** side has a team (`BracketMatchPair` sides are nullable), `contestantsFor("R32-n")` reads each side independently (real team if set, else the static `R32_QUALIFIERS` placeholder label), and the `groupFinals` prop + `resolveQualTeam()` are removed from `BracketBuilder` / `bracket/page.tsx`. `computeGroupFinals()` stays in `bracket-tree.ts` (tests/back-compat) but is no longer used by the UI. No DB/scoring change.
- 2026-06-09: `NumberInput`'s `max` prop is now **optional**, and the Total-goals card on `OutcomesBoard` drops its `max={300}` so that guess is unbounded above (only the `min={0}` floor remains). When `max` is omitted the component skips the upper-bound check, omits the input's `max` attribute, shows a `{min}+` placeholder (was `{min}–{max}`), and the validation message reads "Pick an integer of {min} or more." The other numeric props still pass `max` and are unchanged. Pairs with `setTotalGoalsGuess` dropping its `> 300` branch (`lib/predictions/actions.ts`) and migration `0025_relax_total_goals_cap.sql` relaxing the DB CHECK to `>= 0`. WC 2026's 104 matches can clear 300 in a high-scoring tournament, and closest-guess scoring means an unbounded value can't inflate points. No scoring/point-value change.
- 2026-06-08: `OutcomesBoard` gained a new bottom zone, "Internal league bets" (crown 👑 + wooden spoon 💩), via a new `leagueBets` prop (one entry per league the user is in: `{ leagueId, leagueName, members, selfId, initial, tallies }`). Each renders a `<LeagueBetsCard>` (from `components/league-bets/`); empty state when the user is in no league. The zone reuses the existing `locked` prop and is **not** counted in the betting-slip `filled` meter (league bets are optional + per-league). See `components/league-bets/CLAUDE.md`.
- 2026-06-08: `PlayerSelect` rebuilt from a native `<select>` into a searchable, filterable **combobox** — the ~1,100-player WC catalogue made the flat dropdown unusable (it truncated and couldn't be narrowed). A trigger field opens a sticker popover (`absolute … z-30`, anchored like `PickReactionStrip`, pills styled like `GroupStageList`) with a search box (name **or** country, case-insensitive), DEF/MID/ATT/GK position pills (hidden when no player has a resolvable position), and a country `<select>`; results are flag-decorated via `CountryFlag`, AND-filtered, capped at 100 with a "+N more — keep typing" hint, search autofocused, panel dismissed on click-outside/Escape. Public props + the optimistic `onSave` rollback contract are unchanged, so `OutcomesBoard`'s 3 player call sites and the meter wiring are untouched; `PlayerOption` gained optional `position` / `team_code` / `team_crest`. Position bucketing is the new pure `lib/players/position.ts` (`normalizePosition` tolerant of coarse "Defence"/"Midfield"/"Offence" **and** granular "Centre-Back"/"Defensive Midfield"/"Left Winger" — match order makes "Wing-Back"→DEF and "Defensive Midfield"→MID) with `position.test.ts`. `app/(app)/predict/outcomes/page.tsx` now selects `players.position` + team `code`/`crest_url` (the column existed and was football-data-synced but was never fetched). No DB / migration / scoring change.
- 2026-06-08: `BracketBuilder` R32 entry cells switched from a free `<select>` dropdown to **group-qualification matchups**. `DropdownCell` + the `optionsFor()`/`options` free-pick path are gone; `contestantsFor("R32-n")` now reads `R32_QUALIFIERS` (official WC 2026 Matches 73–88, `lib/scoring/bracket-tree.ts`) and resolves each side to a real team via the imported real fixture (`slotMatches`) or a completed group's winner/runner-up (new `groupFinals` prop from `computeGroupFinals()`), else shows the qualification placeholder (`Runner-up Group K`, `3rd Group A/B/C/D/F`). Third-place sides fill only from the imported fixture. The `Contestant` union replaced `pending` with `feeder` (downstream, → `slotFriendlyName()` "Winner of Quarter-final 1") + `qualifier` (R32 placeholder label); `feederLabel()` (recursive team codes) removed. Team-lines now show the 3-letter `code` + flag (was `short_name` full name). `bracket/page.tsx` fetches finished group-stage matches and passes `groupFinals`. **Behaviour change:** R32 sides stay placeholders until those groups finish (resolution is API-driven, per the design ask), so the bracket fills in during the tournament rather than being freely pickable beforehand. The `LEFT`/`RIGHT` linear slot tree (R32-1&2 → R16-1) is unchanged and still groups slots for the funnel; scoring is per-slot and unaffected. Tests added to `bracket-tree.test.ts`. No DB/SQL changes.
- 2026-06-08: `OutcomesBoard` gained a "House specials" zone — seven admin-resolved props: Neymar 30-min (Yes/No), streaker (Yes/No), clean-sheet-king (goalkeeper pick), top-scoring-nation (team pick), poopy-boot (own-goals number), the war game (group-match pick), Blågult minutes (Swedish-players number). Two new selectors — `BooleanSelect.tsx` (Yes/No) and `MatchSelect.tsx` (server-labelled match dropdown, e.g. "SWE vs DEN · Group A") — both with the standard optimistic-rollback contract. Wired to new `setNeymarMinutesPick` / `setStreakerPick` / `setBestGoalkeeperPick` / `setGoldenBootTeamPick` / `setWarGamePick` / `setOwnGoalsGuess` / `setSwedishPlayersGuess` actions; the completion meter gained a `trackBool` wrapper alongside `trackStr` / `trackNum`. The actual results are entered by an admin in `/admin/props`; scoring (5 pts each, the two numeric ones split ties) runs server-side via `score_manual_props()`. No magic point numbers (copy is text); colours from `globals.css` tokens.
- 2026-06-08: Removed the group-winners picker. `GroupWinnerPicker.tsx` (12 `TeamSelect`s, one per group, each picking a group winner for 5 pts) is deleted — the pick was redundant with the group-stage 1X2 picks, which already imply each group's winner. `OutcomesBoard` lost its "Group forecast" zone, the `teamsByGroup` / `groupPicks` props, and the `seededGroups` meter keys; `/predict/outcomes/page.tsx` dropped the `group_winner_predictions` fetch + derivations. Scoring is retired in migration `0021_remove_group_winner_prop.sql` and `POINTS.tournament.groupWinner` dropped from `lib/scoring/rules.ts`.
- 2026-06-08: New `OutcomesBoard.tsx` (the `/predict/outcomes` body) replaces the old `TournamentForm.tsx` (deleted). It lays the tournament-wide props out as a "betting slip" — a `PropCard` sticker per prop (icon · title · points badge · hint · accent shadow · ✓/— footer; champion card uses `.holo`) grouped into themed zones (The big calls · Boots & bookings · The numbers game · Wildcards · Group forecast, the last folding in `GroupWinnerPicker`). A flat `filled` map seeded from server props drives a live completion meter + progress bar; each selector's `onSave` is wrapped so an `ok` save flips the meter bit (rollback still lives in the selectors). Includes the four new over-under props from migration `0020` (goals in the Final, biggest win margin, golden-boot tally, total red cards) wired to the new `setFinalGoalsGuess` / `setBiggestWinMarginGuess` / `setGoldenBootGoalsGuess` / `setTotalRedCardsGuess` actions. `TeamSelect` / `PlayerSelect` / `NumberInput` gained an optional `label` (omit when `PropCard` owns the title — backward compatible); `GroupWinnerPicker` gained an optional `onPicked` reporter. No new magic numbers (point copy is text); all colours from `globals.css` tokens.
- 2026-06-08: `MatchPickCard` + `GroupStageList` no longer cause React hydration mismatches once group-stage fixtures are seeded. Both rendered timezone-sensitive output during SSR — `MatchPickCard` via `isoToLocal(kickoff_at)` (`Intl.DateTimeFormat("en-GB", ...)`), and `GroupStageList` via `new Date(kickoff_at).toDateString()` used both as the grouping key and the banner label. Server (Vercel = UTC) and client (user TZ) produced different strings; React tore the DOM. Both now defer the localized swap behind a `requestAnimationFrame`-driven `useState` flag (same pattern as `CountdownBanner`): SSR + first client render emit a stable placeholder (`—` for the kickoff line; `YYYY-MM-DD` ISO date prefix for the banner, also used as the bucket key so the group ordering is identical across runtimes); the effect swaps in the localized value after mount. `suppressHydrationWarning` on the two spans is belt-and-braces. Refs Sentry `JAVASCRIPT-NEXTJS-5`.
- 2026-06-08: `BracketBuilder` mobile fit-up. The Wall Chart's shared `minWidth: 54rem` crammed all 9 columns into ~82px cells on phones (vs ~108px on desktop) and the `clamp(600px, 74vh, 720px)` height collapsed to ~600px there, leaving the 8 stacked R32 cells per column almost no gap. Replaced the inline `minWidth` with a responsive class floor — `min-w-[72rem] lg:min-w-0` (full-size, side-scrolling poster below `lg`; releases the floor so `w-full` fits `max-w-6xl` with no scroll on desktop) — bumped the height to `clamp(720px, 80vh, 800px)`, widened the inter-column gap to `gap-3 sm:gap-4`, and let the scroll wrapper bleed to the screen edge on mobile (`-mx-4 px-4 sm:-mx-1 sm:px-1`). Side-scroll a long way beats illegible slivers. No behaviour/scoring change.
- 2026-06-08: `BracketBuilder` rebuilt as **"The Wall Chart"** (second design bundle, Direction 1). Replaced the flat `lg:grid-cols-6` grid of `SlotCard`/`MatchSlotPicker`/`DropdownSlotBody` with a symmetric poster (`LEFT`/`RIGHT` halves → centre Final + Champion) drawn with measured SVG elbow connectors (cells tagged `data-slot`; `localBox()` offset-chain + `measure()` in an effect on rAF/`ResizeObserver`/`fonts.ready`). New `MatchCell` shows two clickable team-lines (pickable only when both contestants known — top-down fill) with recursive `Winner of ESP–DEN` pending labels (`feederLabel()` over `BRACKET_UPSTREAM`); R32 pre-draw keeps a compact `DropdownCell`; `W` is a crown-the-Final-winner sticker (still the real +15 slot). New lifecycle modes from `locked`: **build** (editable) and **live** (read-only, scored from a new `results` prop — ✓/✗ marks, scorelines, `PointsHUD` banked `/85`, champion flip, green/red connectors). Page extends the knockout query with `status,winner,home_score,away_score` and maps `W` ← Final. Removed the "Suggest qualifiers" auto-fill (`r32Suggestions` prop, `setBracketPicksBulk` usage) per the design chat — `bracket-tree.ts` helpers + the action remain (now unused). Points come from `bracketPointsForSlot()`; tokens reuse `globals.css` vars. Fit-to-width desktop (no horizontal scroll), full-size side-scrolling poster on mobile (min-width floor — see the newer mobile-fit entry above for the current values).
- 2026-06-01: `MatchPickCard` re-tap-to-clear now actually clears the pick in the DB. `choose()` sent `next ?? value` to `setMatchPick`, so toggling a tile off cleared the UI optimistically but re-saved the original pick server-side (the action only upserted) and it reappeared on next load — contradicting the documented "re-tap clears the pick" behaviour. Now passes `next` (which is `null` on re-tap); `setMatchPick` accepts `Pick1X2 | null` and DELETEs the `match_predictions` row on null (mirrors `setGroupWinnerPick`). Rollback-on-failure unchanged.
- 2026-05-27: `BracketBuilder` reads real knockout match pairings from a new `slotMatches: Record<bracket_slot, { homeTeamId, awayTeamId }>` prop. When a slot has a real match with both team IDs set, `SlotCard` switches from the dropdown to a new `MatchSlotPicker` — two side-by-side Home / Away tile buttons (sticker-styled like `MatchPickCard`'s `PickTile`, gold-on-ink for the selected team). Slots without a match — and `W`, which has no underlying match row — keep the dropdown. Stale picks (the stored team isn't either tile team, e.g. an old free-dropdown choice that didn't survive the real draw) surface as a coral `Re-pick` badge with both tiles unselected — the DB row stays until the user picks one of the two real teams. Server-side, `r32Suggestions` is pre-filtered through `filterSuggestionsByMatchPairs()` (`lib/scoring/bracket-tree.ts`) so the "Suggest qualifiers" button never bulk-writes a team that isn't one of the match's two teams. Pre-knockout-import the UI is identical to before — `slotMatches` is empty so every slot falls back to dropdown mode.
- 2026-05-27: `BracketBuilder` filters `r32Suggestions` through the actual `slots` prop before counting / applying — defense in depth after the helper started returning at most 16 picks. `validSuggestions` is the only thing the button reads, so a future helper bug that emits an out-of-range slot can never write an orphan row. Suggestion explainer copy updated to "16 likely R32 winners (top advancers by predicted points)" — was misleadingly "32 qualifiers".
- 2026-05-27: `BracketBuilder` extended for WC 2026's Round of 32. Stage union gains `R32`; `STAGE_ORDER` is now `R32 → R16 → QF → SF → F → W`. Grid bumped to `lg:grid-cols-6`. Each slot now filters its `<select>` options through `BRACKET_UPSTREAM` (from `lib/scoring/bracket-tree.ts`): R32 shows all 48 teams; downstream stages restrict to winners picked upstream. Picks are owned in component state (was: per-slot state); changing an upstream slot computes the set of invalidated downstream picks and clears them via `clearBracketPicks()` after the primary `setBracketPick()` succeeds. New "Suggest qualifiers" pitch-green pill above the grid: when the server passes `r32Suggestions` (top-2 per group + best-8 third-place, computed from the user's group-stage 1X2 picks), one click bulk-upserts via `setBracketPicksBulk()` into empty R32 slots only. Server action `clearBracketPicks(slots[])` and `setBracketPicksBulk(picks[])` added to `lib/predictions/actions.ts` — both gated on `locks.round2Locked`.
- 2026-05-25: `GroupStageList.tsx` extracted from `app/(app)/predict/page.tsx`. The static group chip strip became an interactive filter: an "All groups" reset pill plus one pill per group letter; clicking toggles the active filter (re-tap clears, switch to a different group switches). Active pill uses `bg-gold`; complete groups still flip to `bg-pitch` ✓ when inactive. Date-grouping moved into the client component so it re-groups the filtered subset. Server page now passes `picksByMatch` / `groupCoverage` as plain `Record<>` objects (was `Map`) for RSC serialisation.
- 2026-05-25: `CountdownBanner` no longer triggers React hydration mismatches. The lazy `useState` initializer used to call `Date.now()` during SSR, but SSR and hydration run a few hundred ms apart so the formatted string differed and React tore the DOM. `remaining` now starts as `null` (placeholder DOM `--:--:--` on both server and client first render); a `requestAnimationFrame` inside `useEffect` schedules the first real tick, then a 1 s interval drives the countdown. Refs Sentry `JAVASCRIPT-NEXTJS-5` / #47.
- 2026-05-22: Sticker Stadium re-skin. `MatchPickCard` rebuilt with sticker tiles (paper-2 bg, ink shadow, gold selection state) and a "✓ Picked / Pick! / Locked" status pill. Tile tap now toggles (re-tap clears the pick). `BracketBuilder` slots use a dashed-border "?" empty state, gold shadow on the Champion slot when filled, sticker stage headers. `CountdownBanner` rebuilt as a coral-shadow sticker pill with mono `LOCKS IN` label + Archivo Black coral countdown. `TeamSelect` / `PlayerSelect` / `NumberInput` / `GroupWinnerPicker` / `TournamentForm` inherit the new `.input` + `.label` chrome with no behaviour changes. Bracket progressive-reveal (R16 pre-set, QF/SF/F derive from upstream, downstream invalidation) is **not** implemented — tracked in `/DESIGN_MISALIGNMENTS.md` §7.
