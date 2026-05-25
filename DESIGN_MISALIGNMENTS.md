# Design misalignments

> **Non-canon** — companion to the Sticker Stadium visual identity PR. Tracks features
> shown in the Claude Design bundle (`/tmp/design/3-musketeers-wc-game/`) that the
> implementation PR did **not** ship, so they can be picked up later as proper feature
> work. The visual system landed; this list is what's still on the cutting-room floor.

For each item: where the design lives (file + region), what it would need to build for
real, and a one-line rationale for why it didn't land in the foundation PR.

## 1. Banter / chat

**Status (2026-05-25)**: shipped in issue #35 — composer with 180-char counter +
emoji chips, threaded replies (collapsed by default), Supabase Realtime live
updates via `league:<id>:banter`, optimistic insert with rollback. Migration
`0011_banter.sql`, server actions in `lib/banter/actions.ts`, components in
`components/banter/`. League home restructured to 2-column desktop layout
(`lg:grid-cols-[1.8fr_1fr]`) with banter in the right sidebar.

**Still deferred from the design**:
- **Avatar circles / stacked-avatar reply preview** — the design renders emoji
  avatars (⚡ 🦊 🐺 🐝) and a stacked-avatar reply-count preview. v1 ships
  username-only display (matches the rest of the app, which has no Avatar
  component yet). Needs either a `profile_pic_url` column + Supabase Storage
  bucket + upload UI, or a minimal initials-circle component reused across
  leaderboard / banter / member list.
- **Reactions on banter posts** — the design's emoji chips are for *composing*;
  reacting to other users' posts (different from §2 pick-reactions) isn't
  scoped. Would reuse the `pick_reactions` table shape with a `target_kind` =
  `banter_message` / `banter_reply`.
- **Edit support** — design shows post + delete but no edit affordance; shipped
  immutable in v1.
- **"Load older" pagination** beyond the first 50 messages.

## 2. Pick reactions (🔥 💩 😱 👍)

**Design**: `project/sticker-d.jsx` + `project/mobile-c.jsx`. Recent-picks rows and
friends'-picks lists carry a reaction strip. Each row shows current totals as
tappable chips (your reaction highlighted in gold); a "+ react" trigger opens a small
palette above the row.

**Needed to ship**:
- New table: `pick_reactions(pick_id text, pick_kind text, user_id uuid, emoji text)`
  with unique `(pick_id, user_id, emoji)` constraint so a user can toggle exactly one
  of each emoji per pick. `pick_kind` discriminates match / bracket / prop.
- RLS: anyone in the same league can read; only the author can insert/delete their own.
- Server action `togglePickReaction(pickId, kind, emoji)`.
- Aggregation query for counts when loading match detail and profile recent picks.

**Why deferred**: net-new schema + cohort aggregation, requires its own RLS review.

## 3. Pulse stats (League / Tournament)

**Design**: `project/sticker-b.jsx:StickerPulse` + `project/mobile-b.jsx`. Below the
leaderboard: League/Tournament toggle, 4 stat tiles, then highlight rows (most contested
match, group consensus, wildcard pick).

**League stats** (need aggregation queries):
- Leader's gap (top1 - top2 points)
- Hottest streak (longest current correct streak)
- Bold picks (count of picks with <25% league agreement)
- Perfect MDs (matchdays where the user got 100%)
- Most contested match (highest variance in picks)
- Group consensus (group with most agreement on winner)
- Wildcard pick (least-picked correct pick)

**Tournament stats**:
- Avg goals per finished match
- Upsets so far (matches where favourite lost, by FIFA rank delta)
- Total goals scored
- Red cards count (from `player_card_log`)
- Most-picked champion (top of `tournament_predictions.winner_team_id` aggregation)
- Top golden boot pick
- Cinderella vote (most-picked dark horse)

**Why deferred**: each tile is one query but the set is large; should ship as its own PR
with a `lib/stats/pulse.ts` module.

## 4. Pick personality (Profile)

**Design**: `project/sticker-d.jsx` + `project/mobile-c.jsx`. Replaces the rejected
per-MD accuracy chart. Includes:
- Stacked Home/Draw/Away pick-mix bar
- Three "you vs league average" comparison bars: Group acc, Knockout acc, Bracket survival.
  Your bar overlays a hatched league-avg track.
- Three secondary stats: Boldness % (low-consensus picks), Avg pick time, Upsets called.

**Needed to ship**:
- Aggregation on `match_predictions` per user: count by pick value, accuracy split by
  stage (group vs knockout).
- League-wide cohort: same aggregations averaged across the user's leagues so the
  comparison track has data.
- New `lib/stats/personality.ts` module.
- `components/stats/PickPersonality.tsx` client component (read-only, no actions).

**Why deferred**: this PR keeps `loadProfileStats` untouched. The profile page now shows
a placeholder card noting where this will land. The original `AccuracyChart` component
is still in `components/stats/AccuracyChart.tsx` but is no longer rendered (per chat2:
"per-MD doesn't apply — all predictions lock at tournament start").

## 5. Album progress strip

**Design**: `project/sticker-b.jsx` league screen. 80-cell grid showing the user's
collection state — green cells = collected, coral = pending, gold = upcoming, paper-2 =
locked.

**Needed to ship**:
- Derive "stickers collected" from `match_predictions` count + tournament/prop picks.
- Define what 80 means (current design hard-codes it; in reality the count is matches +
  tournament outcomes + props = some larger number).

**Why deferred**: cosmetic + depends on settling the "album" naming question (#14).

## 6. Live indicator pill (● N LIVE)

**Design**: `project/sticker-a.jsx:StickerChrome`, top nav. Red pill counting
in-progress matches.

**Needed to ship**: a server-side count of matches where `status IN ('IN_PLAY','PAUSED')`,
revalidated on every navigation. The data is available; the Nav just needs to query it.

**Why deferred**: would require Nav to fetch additional data on every gated route render.
Belongs in a follow-up that also pulls a "next match" indicator into the chrome.

## 7. Bracket progressive reveal (behaviour, not just visual)

**Design**: `project/sticker-c.jsx:StickerBracket` + `project/mobile-c.jsx`. Critical
behaviour from chat2:
- R16 is the only stage with pre-set teams (8 pairings derived from group
  winners/runners-up).
- QF / SF / Final matchups derive **live** from the previous stage's picks. Where a
  winner hasn't been picked, the slot shows a dashed "?" + "Awaiting previous winner".
- Champion screen only lets you choose from your two finalists.
- Stage tabs show 🔒 + lock state + per-stage progress (`0/8 · +2pt`).
- Changing an upstream pick **wipes downstream picks** to keep the bracket consistent.

**Current state**: `components/predict/BracketBuilder.tsx` shows every stage at once and
all 48 teams are valid options at every slot. Empty slots already render as dashed-border
"?" cards (visual nod to the design) but there's no functional gating.

**Needed to ship**:
- Filter `slot.options` per stage based on upstream picks (server-side from
  `bracket_predictions`).
- A new server action `setBracketPick` variant that, when an upstream slot changes,
  wipes the downstream slots in the same transaction.
- Stage tabs with progress + lock indicators.

**Why deferred**: it's a real behaviour + UX rework, not a re-skin. Will need its own
correctness review against the existing scoring SQL functions (`score_bracket`).

## 8. Standalone `/props` route

**Design**: `project/sticker-c.jsx:StickerProps` — winner / runner-up / golden boot /
dark horse picker on its own screen, with team-list search.

**Current state**: props are integrated into `/predict` via `TournamentForm` and
`GroupWinnerPicker`. Deliberate: chat2 confirmed predictions all lock together.

**Why deferred**: not a misalignment per se — recording this so future readers don't
re-introduce the design's split.

## 9. Country-colour team sticker visual

**Design**: each team sticker has a bold colour band (Argentina blue, Brazil gold, etc.)
behind the flag and code, not just a crest.

**Current state**: `components/CountryFlag.tsx` renders either the football-data crest
URL or a paper-coloured fallback with the team code.

**Needed to ship**: `teams.primary_color` (+ optionally `secondary_color`) columns
populated either from a curated TS map or pulled from football-data. Then a
`<TeamSticker>` component that wraps the flag in the colour band.

**Why deferred**: net-new column + curation. The landing-page sticker stack already
demonstrates the look with hard-coded colours.

## 10. 3-step join flow

**Design**: `project/sticker-a.jsx:StickerJoin` — Preview → Email → Success.

**Current state**: Preview → Magic-link sent (or instant accept if already signed in).
Supabase magic link replaces the email-collection step; this is intentional and
documented.

## 11. Holographic card effect

The `.holo` class is implemented in `globals.css` using two stacked gradient layers with
`mix-blend-mode`. It works on desktop Chrome and Safari; mobile Safari sometimes flattens
`mix-blend-mode: overlay` when the parent has a backdrop filter. Flagged for QA — if any
hero card looks flat on iOS, the fallback is to drop `mix-blend-mode` and reduce opacity.

Used today on: nothing in this PR — kept as a building block for the "your big sticker"
holo card on the leaderboard sidebar (deferred).

## 12. Group chip ✓-when-complete

**Implemented** in `app/(app)/predict/page.tsx`. The only design feature beyond pure
styling that ships in this PR. Computed inline from the `picksByMatch` map.

## 13. Tweaks panel + Bottom prototype bar

`project/tweaks-panel.jsx` + `Kickoff.html`'s `<BottomBar>` are prototype-only chrome and
intentionally not implemented.

## 14. "Album" naming

Chat2 left this open. Current default: keep "album" / "collect" / "stickers" in branded
moments only (eyebrow badges, CTA copy on landing: "Start the album") and **not** in
primary navigation labels (no "Your collection" item, no "Album progress" header). Pick
a direction before adding banter/Pulse/album-progress — once UX labels start using the
word, it's harder to walk back.

## 15. Holo card on leaderboard sidebar ("your big sticker")

**Design**: `project/sticker-b.jsx` shows a hero holographic card on the leaderboard
right rail with rank, points, "next to collect" match + countdown, and a coral "▶ Pick
now" button.

**Current state**: the leaderboard is a single-column list. The user's row gets the gold
+ coral-shadow treatment but the hero card with countdown + next-match callout isn't
implemented yet.

**Needed to ship**: query the next unpicked / next-up match for the current user, render
a `.sticker.holo` card with countdown to that match's kickoff. Pairs naturally with #6
(live pill) and #11 (holographic effect).

## 16. Match-detail tabs (Friends / Events / Lineups)

**Design**: `project/sticker-c.jsx:StickerMatchDetail` + `project/mobile-c.jsx`. Three
tabs under the score hero.

**Current state**: only the "friends" content is rendered (and only once the match is
locked). Events (goals, cards) and lineups don't have UI yet, although the data exists
via `player_goal_log` and `player_card_log`.
