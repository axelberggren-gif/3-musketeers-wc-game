> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# components/social/ — social-layer client components

## Purpose
Client components that layer banter / reactions on top of already-rendered picks.
First inhabitant: `PickReactionStrip`. Future home for the §1 banter composer +
reply threads once those land.

## Key files
- `PickReactionStrip.tsx` — Four-emoji (🔥 💩 😱 👍) chip strip with `+ react`
  popover. Optimistic toggle via `useTransition`; rolls back on action failure.
  Pill chips are paper-2 idle, gold when the viewer has reacted. Mirrors the
  `MatchPickCard.tsx:choose()` optimistic pattern verbatim.

## Conventions
- Every file is `"use client"`. Persistence is via server actions in
  `lib/predictions/actions.ts` (or future `lib/social/actions.ts`).
- Pass aggregates as plain props from a server component — `initialCounts` is a
  `Record<emoji, number>` and `initialMine` is a serialised array (Set isn't a
  React-serialisable prop type, so the parent must `Array.from(set)` it).
- `revalidatePath` is an optional caller-provided string the action invalidates
  after a successful toggle. Lets the same component work on `/match/[id]` and
  `/profile/[username]` without baking the path into the component.
- Sticker Stadium chip styling: `rounded-full`, `border-2 border-ink`,
  `bg-paper-2` idle, `bg-gold` + `boxShadow: "1px 1px 0 var(--ink)"` when mine.
  `+ react` trigger uses `border-dashed`.

## Invariants (do not break)
- Server actions are the only persistence path — never write directly to
  Supabase from a client component. RLS would reject anonymous writes anyway.
- The emoji set is a closed enum (`🔥 💩 😱 👍`) enforced by the DB CHECK
  constraint, the TS type `PickReactionEmoji`, and the action's runtime guard.
  Don't extend without a matching migration + type update.
- Server actions return `{ ok: true } | { ok: false; error: string }`. The
  component must handle both — roll back optimistic state on `!ok`.

## Known gotchas
- Optimistic state clones the previous `Set` before mutating, so React sees a
  new reference and rerenders. Mutating in place is silently broken.
- The popover renders absolutely positioned with `bottom: calc(100% + 4px)`
  so it opens upward. Inside a scrollable container with clipping, this can
  visually clip — wrap the host row in `position: relative` if needed.

## Recent changes
- 2026-05-25: Created `PickReactionStrip` for #36. First social-layer
  component. Wired into `/match/[id]` friends-picks list and a new "Recent
  picks" section on `/profile/[username]`. Data layer: migration
  `0012_pick_reactions.sql`, server action `togglePickReaction` in
  `lib/predictions/actions.ts`, aggregator `lib/predictions/reactions.ts`.
