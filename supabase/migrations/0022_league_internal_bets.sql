-- World Cup 2026 Bet Game — internal league bets (crown 👑 + poop 💩).
--
-- Two league-internal social bets, settled the moment the group stage finishes:
--   * Crown (most points): each member votes for who they think finishes the
--     group stage on the MOST points. The member who actually does is penalised
--     -5 per crown-vote they received. Penalty-only — voters get nothing.
--   * Poop (least points): each member votes for who finishes on the LEAST
--     points. (a) every voter whose pick IS the actual loser gets +5; (b) the
--     actual loser gets +2 per poop-vote received (consolation).
--
-- "Points after the group stage" = a member's group-stage 1X2 match points only
-- (point_awards of prediction_type='match' on stage='GROUP' matches). The
-- first-eliminated prop is intentionally NOT counted.
--
-- Why a league_id on point_awards
-- -------------------------------
-- Points were global per user: point_awards had no league_id and league_standings
-- summed every award into every league a user belongs to. These bets are
-- per-league (you can be the loser in one league but not another), so the awards
-- MUST be league-scoped. We add a nullable point_awards.league_id (NULL = global,
-- as every existing scorer writes; set = league-scoped, only these bets) and teach
-- league_standings to credit a league-scoped award only to its own league. The
-- league-bet awards reuse prediction_type='tournament' (so they fold into
-- tournament_points + total_points) with a distinct 'league_bet:' idempotency-key
-- prefix, so no other scorer's prefix-scoped reconcile DELETE ever touches them.
--
-- Append-only: 0002 (view) / 0021 (settle_group_stage_props) are untouched; the
-- create-or-replace + matview recreate below supersede them.

-- ---------------------------------------------------------------------------
-- 1. League-scope point_awards
-- ---------------------------------------------------------------------------
alter table point_awards add column if not exists league_id uuid references leagues(id) on delete cascade;
create index if not exists point_awards_league_idx on point_awards (league_id);

-- ---------------------------------------------------------------------------
-- 2. Recreate league_standings so a league-scoped award only counts in its
--    league. Identical to 0002 except the point_awards join predicate.
-- ---------------------------------------------------------------------------
drop function if exists refresh_league_standings();
drop materialized view if exists league_standings;
create materialized view league_standings as
select
  lm.league_id,
  p.id as user_id,
  p.username,
  p.display_name,
  coalesce(sum(case when pa.prediction_type = 'match' then pa.points end), 0)::int as match_points,
  coalesce(sum(case when pa.prediction_type = 'bracket' then pa.points end), 0)::int as bracket_points,
  coalesce(sum(case when pa.prediction_type = 'tournament' then pa.points end), 0)::int as tournament_points,
  coalesce(sum(case when pa.prediction_type = 'prop' then pa.points end), 0)::int as prop_points,
  coalesce(sum(pa.points), 0)::int as total_points
from league_members lm
join profiles p on p.id = lm.user_id
left join point_awards pa
  on pa.user_id = p.id
  and (pa.league_id is null or pa.league_id = lm.league_id)
group by lm.league_id, p.id, p.username, p.display_name;

create unique index if not exists league_standings_pk on league_standings (league_id, user_id);
create index if not exists league_standings_total_idx on league_standings (league_id, total_points desc);

create or replace function refresh_league_standings()
returns void
language sql
security definer
as $$
  refresh materialized view concurrently league_standings;
$$;

-- Seed the freshly-recreated matview: REFRESH ... CONCURRENTLY (used at runtime)
-- cannot run against a never-populated matview, so prime it once here.
refresh materialized view league_standings;

-- ---------------------------------------------------------------------------
-- 3. league_group_bets — one crown vote + one poop vote per member, per league
-- ---------------------------------------------------------------------------
create table if not exists league_group_bets (
  league_id  uuid not null references leagues(id) on delete cascade,
  voter_id   uuid not null references profiles(id) on delete cascade,
  bet_kind   text not null check (bet_kind in ('most_points', 'least_points')),
  votee_id   uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (league_id, voter_id, bet_kind)
);

create index if not exists lgb_votee_idx on league_group_bets (league_id, bet_kind, votee_id);

alter table league_group_bets enable row level security;

-- Read your own votes always.
drop policy if exists "lgb_read_self" on league_group_bets;
create policy "lgb_read_self" on league_group_bets
  for select to authenticated using (voter_id = auth.uid());

-- Read league-mates' votes only after round 1 locks (mirrors tp_read_after_lock);
-- is_league_member() is SECURITY DEFINER so this doesn't recurse RLS.
drop policy if exists "lgb_read_after_lock" on league_group_bets;
create policy "lgb_read_after_lock" on league_group_bets
  for select to authenticated using (
    round1_locked() and is_league_member(league_id, auth.uid())
  );

-- Write only your own votes, and only for a league where both you and the votee
-- are members.
drop policy if exists "lgb_write_self" on league_group_bets;
create policy "lgb_write_self" on league_group_bets
  for all to authenticated
  using (voter_id = auth.uid())
  with check (
    voter_id = auth.uid()
    and is_league_member(league_id, auth.uid())
    and is_league_member(league_id, votee_id)
  );

-- Votes lock at first kickoff, like all round-1 picks (DB-enforced).
drop trigger if exists league_group_bets_lock on league_group_bets;
create trigger league_group_bets_lock
  before insert or update on league_group_bets
  for each row execute function enforce_round1_lock();

-- ---------------------------------------------------------------------------
-- 4. Point constants (kept in sync with lib/scoring/rules.ts POINTS.leagueBet)
-- ---------------------------------------------------------------------------
create or replace function points_league_loser_guess()            returns integer language sql immutable as $$ select 5 $$;
create or replace function points_league_loser_per_vote()         returns integer language sql immutable as $$ select 2 $$;
create or replace function points_league_crown_penalty_per_vote() returns integer language sql immutable as $$ select 5 $$;

-- ---------------------------------------------------------------------------
-- 5. score_league_group_bets() — settle the crown + poop bets per league once
--    the entire group stage is FINISHED. Reconcile model (delete-stale then
--    insert) so an admin override / football-data revision self-heals. Awards
--    are league-scoped (point_awards.league_id set).
-- ---------------------------------------------------------------------------
create or replace function score_league_group_bets()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  awarded integer := 0;
begin
  -- Only settle once every group-stage match is FINISHED.
  if exists (select 1 from matches where stage = 'GROUP' and status <> 'FINISHED') then
    -- Group stage not (yet) complete — a FINISHED result may have reverted.
    -- Drop any awards we previously wrote so standings don't keep stale points.
    delete from point_awards where idempotency_key like 'league_bet:%';
    return 0;
  end if;

  -- ON COMMIT DROP cleans the scratch table up when the (RPC) transaction ends;
  -- pg_temp is in search_path so it resolves unqualified, and public is searched
  -- first so a temp table can't shadow the real tables this function reads.
  create temp table tmp_league_bet_desired on commit drop as
  with gs_points as (
    -- Each member's group-stage 1X2 points: global match awards on GROUP matches.
    -- league_bet awards (league_id set, type 'tournament') are excluded, so the
    -- ranking can't feed back on itself.
    select
      lm.league_id,
      lm.user_id,
      coalesce(sum(pa.points) filter (
        where pa.prediction_type = 'match' and m.stage = 'GROUP'
      ), 0) as pts
    from league_members lm
    left join point_awards pa on pa.user_id = lm.user_id and pa.league_id is null
    left join matches m on m.id = pa.match_id
    group by lm.league_id, lm.user_id
  ),
  extremes as (
    -- Only leagues with an actual spread settle (skips fully-tied / 1-member ones).
    select league_id, max(pts) as max_pts, min(pts) as min_pts
    from gs_points
    group by league_id
    having max(pts) <> min(pts)
  ),
  winners as (  -- crowned: members on the most points (ties → all of them)
    select g.league_id, g.user_id
    from gs_points g
    join extremes e on e.league_id = g.league_id
    where g.pts = e.max_pts
  ),
  losers as (   -- pooped: members on the least points (ties → all of them)
    select g.league_id, g.user_id
    from gs_points g
    join extremes e on e.league_id = g.league_id
    where g.pts = e.min_pts
  ),
  crown_tally as (
    select league_id, votee_id, count(*) as votes
    from league_group_bets where bet_kind = 'most_points'
    group by league_id, votee_id
  ),
  poop_tally as (
    select league_id, votee_id, count(*) as votes
    from league_group_bets where bet_kind = 'least_points'
    group by league_id, votee_id
  ),
  desired as (
    -- Crown penalty: a crowned winner who received crown votes loses 5 per vote.
    select
      w.user_id    as user_id,
      w.league_id  as league_id,
      w.user_id    as prediction_ref,
      (-1 * points_league_crown_penalty_per_vote() * ct.votes)::int as points,
      'league_bet:crown_penalty:' || w.league_id::text || ':' || w.user_id::text as idempotency_key
    from winners w
    join crown_tally ct on ct.league_id = w.league_id and ct.votee_id = w.user_id
    union all
    -- Poop consolation: the actual loser gets 2 per poop vote received.
    select
      l.user_id,
      l.league_id,
      l.user_id,
      (points_league_loser_per_vote() * pt.votes)::int,
      'league_bet:poop_loser:' || l.league_id::text || ':' || l.user_id::text
    from losers l
    join poop_tally pt on pt.league_id = l.league_id and pt.votee_id = l.user_id
    union all
    -- Poop correct guess: a voter whose pick is an actual loser gets +5.
    select
      b.voter_id,
      b.league_id,
      b.voter_id,
      points_league_loser_guess()::int,
      'league_bet:poop_guess:' || b.league_id::text || ':' || b.voter_id::text
    from league_group_bets b
    join losers l on l.league_id = b.league_id and l.user_id = b.votee_id
    where b.bet_kind = 'least_points'
  )
  select user_id, league_id, prediction_ref, points, idempotency_key from desired;

  -- Reconcile: drop awards we own whose (key, points) no longer matches.
  delete from point_awards pa
  where pa.idempotency_key like 'league_bet:%'
    and not exists (
      select 1 from tmp_league_bet_desired d
      where d.idempotency_key = pa.idempotency_key
        and d.points = pa.points
    );

  -- Insert the correct league-scoped awards (prediction_type='tournament').
  insert into point_awards (user_id, prediction_type, prediction_ref, league_id, points, idempotency_key)
  select user_id, 'tournament', prediction_ref, league_id, points, idempotency_key
  from tmp_league_bet_desired
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Drive the new scorer from the group-stage settlement hook. syncFixtures()
--    calls settle_group_stage_props() after score_match() (so group awards exist)
--    and before refresh_league_standings() — no sync.ts change needed.
-- ---------------------------------------------------------------------------
create or replace function settle_group_stage_props()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform score_first_eliminated();
  perform score_league_group_bets();
end;
$$;
