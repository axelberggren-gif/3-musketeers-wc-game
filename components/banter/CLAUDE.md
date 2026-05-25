> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# components/banter/ — league chat UI (client components)

## Purpose
Client components for the per-league Banter feed: a sticker-styled composer with
180-char counter + emoji chips, threaded replies, and live updates via Supabase
Realtime. Mounts inside the league home page (`app/(app)/leagues/[slug]/page.tsx`)
on the desktop right sidebar (`lg:grid-cols-[1.8fr_1fr]`) and stacked below stats
on mobile. Backed by `lib/banter/actions.ts` and the `banter_messages` /
`banter_replies` tables from migration `0011_banter.sql`.

## Key files
- `BanterFeed.tsx` — Container. Owns `messages`, `replies`, `expandedThreads` state.
  Subscribes to channel `league:${leagueId}:banter` on mount, listens for
  INSERT/DELETE on both `banter_messages` (filtered by `league_id`) and
  `banter_replies` (client-side filtered by visible message ids — replies have no
  `league_id`).
- `BanterComposer.tsx` — Top-level composer. Optimistic post with rollback.
  Emoji chips (🔥 😭 💀 🤡) insert at the textarea caret via
  `selectionStart`/`setSelectionRange`. Counter (`{n}/180`) flips `text-coral` and
  the Post button disables when `body.length > 180`.
- `BanterMessage.tsx` — One message card with author + body + relative timestamp.
  Author-only `✕` delete button (UI only — RLS is the real gate). Collapsible
  reply thread; expand toggle shows reply count + ▾/▸. When expanded, renders
  `BanterReplyComposer` inline.
- `BanterReplyComposer.tsx` — Single-line input mounted inside an expanded thread.
  No emoji chips (top composer-only per AC). Same 180-char rule + optimistic flow
  as `BanterComposer`.

## Conventions
- Every file starts with `"use client"`. Persistence is via server actions imported
  from `lib/banter/actions.ts`.
- **Optimistic updates with rollback**, mirroring `components/predict/MatchPickCard.tsx`:
  set state with a `temp-${crypto.randomUUID()}` id; call the server action in
  `startTransition`; on `ok` swap the temp id with the returned real id (so the
  Realtime INSERT event for the same row collapses cleanly via dedup-by-id); on
  `!ok` remove the temp row and surface `result.error`.
- **Tailwind v4 utilities + sticker primitives** from `app/globals.css` (`.card`,
  `var(--ink)`, `var(--paper-2)`, `var(--coral)`, `var(--gold)`, `font-display`,
  `font-mono-sticker`). No inline colour literals.
- **Username-only display** in v1 — no Avatar component yet. The design's "stacked
  avatars" line item is tracked as a follow-up in `DESIGN_MISALIGNMENTS.md` §1.
  Render `display_name ?? username` plus `@username` for handle context.

## Invariants (do not break)
- **180-char cap is triple-enforced**: client (counter + disable), server action
  (`validateBody()` in `lib/banter/actions.ts`), and Postgres CHECK constraint
  (`length(body) between 1 and 180`). All three must stay aligned — change one,
  change them all and add a migration.
- **Channel name is `league:${leagueId}:banter`** — used both here and (implicitly)
  in any future server-side broadcast. Don't rename without updating the
  subscriber.
- **`banter_replies` INSERT events have no `league_id` filter** server-side —
  client filters by `messageIds ∈ visible`. RLS prevents cross-league reads
  regardless, so this is defence in depth.
- Server actions return the discriminated union `{ ok: true; id: string } |
  { ok: false; error: string }`. UI must handle both branches — never assume
  success.
- Realtime cleanup: every channel subscription MUST `supabase.removeChannel(channel)`
  in its `useEffect` return. See `BanterFeed.tsx`.

## Known gotchas
- **Optimistic + realtime dedup**: when the local user posts, both an optimistic
  insert AND a realtime INSERT for the persisted row land in state. The
  reconcile step swaps the temp id to the real id; if the realtime event already
  added a row with that real id, the dedup-by-id pass drops the optimistic
  duplicate. Either path is safe.
- **DELETE realtime payload only has `old.id`** (Postgres default `REPLICA
  IDENTITY`) — that's enough for our filter-by-id removals.
- Threads collapse by default. When you post a reply, the parent thread
  auto-expands so you see your own reply immediately.
- The `lg:grid-cols-[1.8fr_1fr]` split in `app/(app)/leagues/[slug]/page.tsx` is
  the mount point. Mobile (< lg) stacks the sidebar below the stats sections.
- Profile resolution uses a server-side-prefetched `profilesById` map (built from
  `league_members` ⋈ `profiles`). New posters who joined after page load fall
  back to `"unknown"`; expected to be vanishingly rare and self-heals on next
  navigation.

## Recent changes
- 2026-05-25: initial banter feature shipped (issue #35). Migration
  `0011_banter.sql` introduces `banter_messages` + `banter_replies` (cascade on
  parent delete) with RLS via `is_league_member` + new
  `banter_message_league_id` SECURITY DEFINER helper; both tables registered
  with the `supabase_realtime` publication. Server actions in
  `lib/banter/actions.ts` enforce the 1..180 body validation server-side.
  League page restructured to a 2-column desktop layout
  (`lg:grid-cols-[1.8fr_1fr]`) with banter in the right sidebar.
