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

## 2. Pick reactions (🔥 💩 😱 👍) — **Shipped 2026-05-25 (#36)**

Match-kind reactions ship in #36: migration `0012_pick_reactions.sql` (polymorphic
`pick_id` / `pick_kind` with CHECK on the four emojis + four kinds, league-mate
read RLS via inline EXISTS, write-self only), `togglePickReaction` server action
(select-then-delete-or-insert toggle), `loadPickReactions` aggregator (single
round-trip), and `components/social/PickReactionStrip.tsx` (paper-2 / gold pill
chips, dashed `+ react` trigger, optimistic rollback). Wired into
`/match/[id]` friends-picks list and a new `/profile/[username]` Recent picks
section.

**Still deferred**: bracket / tournament / prop reactions (the DB CHECK allows
the kinds but no UI surface mints them), Supabase Realtime broadcast for live
counts (still revalidate-on-tap), and orphan cleanup when a host pick is
deleted.

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

**Status (2026-06-09)**: shipped. The `/profile/[username]` placeholder card is now the
real thing — `components/stats/PickPersonality.tsx` (a **server** presentational component,
not the "client component" the original note imagined — it has no interactivity), fed by the
new `lib/stats/personality.ts` aggregator (`loadPickPersonality(userId, viewerId)` + pure,
unit-tested helpers in `personality.test.ts`). It renders the full design:
- Stacked Home/Draw/Away **pick-mix bar**.
- Three **"you vs league average"** comparison bars — Group accuracy, Knockout accuracy,
  Bracket survival — each a solid user fill over a hatched (`repeating-linear-gradient`)
  league-average ghost track. League average = mean of each cohort member's own accuracy.
- Three secondary stats: **Boldness %** (picks shared by <25% of the league cohort),
  **Avg pick time** (mean lead before kickoff), **Upsets called** (correct group picks where
  the FIFA-weaker side won by ≥5 ranks).

Visible on **every** profile, populated by what RLS lets the viewer see (full on your own;
your revealed picks to a league-mate; hidden for strangers → the card is omitted). The
cohort + boldness fill in as the tournament plays. To make the cohort available from
group-stage start (not match-by-match), migration `0026_reveal_group_picks_at_round1_lock.sql`
aligns `match_predictions` reveal to round-1 lock, matching how `tournament_predictions`
already reveal. Bracket survival = the champion (`W`) pick's rounds-won as a fraction of the
knockout ladder. No service-role, no scoring change.

**Still here**: the original `AccuracyChart.tsx` (the rejected per-MD chart) remains
orphaned in `components/stats/` — a candidate for deletion (+ dropping `recharts`) in a
follow-up.

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

**Status (2026-06-08)**: shipped as **"The Wall Chart"** redesign (Direction 1 of the
second design bundle, `project/Wall Chart.html` + `bracket-wallchart.jsx` /
`bracket-engine.jsx`). `components/predict/BracketBuilder.tsx` is now a symmetric
tournament poster with measured SVG elbow connectors, top-down progressive reveal
("Winner of ESP–DEN" pending labels that resolve recursively up the feeder tree), a
crown-the-champion sticker, and a live-scored read-only mode (✓/✗ marks, real scorelines,
banked-points HUD `/85`, champion flip on a missed final) driven by `matches.status` /
`winner` once Round 2 locks. Functional gating + downstream-wipe (`clearBracketPicks`)
already landed 2026-05-27; this PR replaces the flat grid with the poster and adds the
live layer. Champion stays a real `W` slot (+15) — crowning sets it, preserving the
scoring contract. The "Suggest qualifiers" auto-fill was removed per the design chat
(decide every pick yourself). Fit-to-width on desktop (no horizontal scroll); the chart
scrolls horizontally on narrow screens.

**Original deferral note (superseded above)** — design from `project/sticker-c.jsx:StickerBracket`
+ `project/mobile-c.jsx`; critical behaviour from chat2:
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

**Current state**: props live on the `/predict/outcomes` tab via `OutcomesBoard`.
Deliberate: chat2 confirmed predictions all lock together. (The group-winners picker
was later removed — redundant with the group-stage 1X2 picks.)

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
