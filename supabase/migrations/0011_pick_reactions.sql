-- Emoji reactions (🔥 💩 😱 👍) on picks. Polymorphic over (pick_id, pick_kind):
--   - match     → match_predictions.id
--   - bracket   → bracket_predictions.id
--   - tournament→ tournament_predictions has no synthetic id (PK is user_id);
--                 the CHECK constraint allows the value for forward compat,
--                 but v1 has no UI surface that mints tournament-kind rows.
--   - prop      → player_prop_predictions.id
--
-- pick_id is text (not uuid) because the polymorphic targets don't share a
-- type and a future v2 may reference rows that aren't uuid-keyed. Forfeits
-- FK integrity; orphan cleanup is left to a periodic sweeper if/when needed.
--
-- One reaction per (user, pick, emoji). Toggle semantics live in the
-- togglePickReaction server action: select-existing → delete-or-insert.

create table if not exists pick_reactions (
  id uuid primary key default gen_random_uuid(),
  pick_id text not null,
  pick_kind text not null check (pick_kind in ('match','bracket','tournament','prop')),
  user_id uuid not null references profiles(id) on delete cascade,
  emoji text not null check (emoji in ('🔥','💩','😱','👍')),
  created_at timestamptz not null default now(),
  unique (pick_id, pick_kind, user_id, emoji)
);

create index if not exists pick_reactions_pick_idx on pick_reactions (pick_id, pick_kind);
create index if not exists pick_reactions_user_idx on pick_reactions (user_id);

alter table pick_reactions enable row level security;

-- Two separate SELECT policies (PostgreSQL takes their UNION) — mirrors the
-- mp_read_self / mp_read_after_kickoff split in 0001_init.sql. Reactions are
-- league-scoped: any league-mate can read; the host pick's RLS already gates
-- whether the user can see the underlying pick at all.
drop policy if exists "pr_read_self" on pick_reactions;
create policy "pr_read_self" on pick_reactions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "pr_read_league_mate" on pick_reactions;
create policy "pr_read_league_mate" on pick_reactions
  for select to authenticated using (
    exists (
      select 1 from league_members lm_self
      join league_members lm_other on lm_other.league_id = lm_self.league_id
      where lm_self.user_id = auth.uid() and lm_other.user_id = pick_reactions.user_id
    )
  );

drop policy if exists "pr_write_self" on pick_reactions;
create policy "pr_write_self" on pick_reactions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
