-- World Cup 2026 Bet Game — scoring + invite-consumption fixes.
--
-- Replaces score_bracket() / score_tournament() so their returned row counts
-- reflect every INSERT (previously only the last). Adds redeem_league_invite()
-- so invite redemption happens in one transaction (the prior SELECT-then-UPDATE
-- in lib/auth/invite.ts could exceed max_uses under concurrent joins).
--
-- Point constants are unchanged — keep lib/scoring/rules.ts in sync.

create or replace function score_bracket()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  awarded integer := 0;
  delta integer := 0;
begin
  -- Per-slot stages: R16, QF, SF, F.
  insert into point_awards (user_id, prediction_type, prediction_ref, match_id, points, idempotency_key)
  select
    bp.user_id,
    'bracket'::prediction_type,
    bp.id,
    m.id,
    points_bracket_slot(bp.bracket_slot),
    'bracket:' || bp.user_id::text || ':' || bp.bracket_slot
  from bracket_predictions bp
  join matches m on m.bracket_slot = bp.bracket_slot
  where m.status = 'FINISHED'
    and m.winner is not null
    and (
      (m.winner = 'HOME' and m.home_team_id = bp.team_id)
      or (m.winner = 'AWAY' and m.away_team_id = bp.team_id)
    )
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count;
  awarded := awarded + delta;

  -- Special slot 'W' (overall champion) — match is the Final.
  insert into point_awards (user_id, prediction_type, prediction_ref, match_id, points, idempotency_key)
  select
    bp.user_id,
    'bracket'::prediction_type,
    bp.id,
    m.id,
    points_bracket_slot('W'),
    'bracket:' || bp.user_id::text || ':W'
  from bracket_predictions bp
  join matches m on m.bracket_slot = 'F'
  where bp.bracket_slot = 'W'
    and m.status = 'FINISHED'
    and m.winner is not null
    and (
      (m.winner = 'HOME' and m.home_team_id = bp.team_id)
      or (m.winner = 'AWAY' and m.away_team_id = bp.team_id)
    )
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count;
  awarded := awarded + delta;

  return awarded;
end;
$$;

create or replace function score_tournament()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  final_match matches%rowtype;
  winner_team_id uuid;
  runner_up_team_id uuid;
  sf_team_ids uuid[];
  awarded integer := 0;
  delta integer := 0;
begin
  select * into final_match from matches where bracket_slot = 'F' limit 1;
  if not found or final_match.status <> 'FINISHED' or final_match.winner is null then
    return 0;
  end if;

  if final_match.winner = 'HOME' then
    winner_team_id := final_match.home_team_id;
    runner_up_team_id := final_match.away_team_id;
  else
    winner_team_id := final_match.away_team_id;
    runner_up_team_id := final_match.home_team_id;
  end if;

  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_tournament_winner(),
         'tournament:winner:' || tp.user_id::text
  from tournament_predictions tp
  where tp.winner_team_id = winner_team_id
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count;
  awarded := awarded + delta;

  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_tournament_runner_up(),
         'tournament:runner_up:' || tp.user_id::text
  from tournament_predictions tp
  where tp.runner_up_team_id = runner_up_team_id
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count;
  awarded := awarded + delta;

  select array_agg(distinct team_id) into sf_team_ids from (
    select home_team_id as team_id from matches where stage = 'SF' and home_team_id is not null
    union
    select away_team_id from matches where stage = 'SF' and away_team_id is not null
  ) s;

  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_dark_horse(),
         'tournament:dark_horse:' || tp.user_id::text
  from tournament_predictions tp
  where tp.dark_horse_team_id = any(sf_team_ids)
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count;
  awarded := awarded + delta;

  with goals as (
    select pa.player_id, count(*) as goals
    from player_goal_log pa
    group by pa.player_id
  ),
  top as (
    select player_id from goals where goals = (select max(goals) from goals)
  )
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_top_scorer(),
         'tournament:top_scorer:' || tp.user_id::text
  from tournament_predictions tp
  join top on top.player_id = tp.top_scorer_player_id
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count;
  awarded := awarded + delta;

  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select ppp.user_id, 'prop', ppp.id, points_player_prop(),
         'prop:' || ppp.user_id::text || ':' || ppp.prop_key
  from player_prop_predictions ppp
  join player_prop_resolutions ppr on ppr.prop_key = ppp.prop_key
  where ppp.player_id = ppr.player_id
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count;
  awarded := awarded + delta;

  return awarded;
end;
$$;

-- Atomic invite redemption: validates, inserts membership, and increments
-- uses_count in one transaction. Locks the league_invites row FOR UPDATE so
-- two concurrent redemptions cannot both observe uses_count < max_uses and
-- both succeed past the cap.
create or replace function redeem_league_invite(p_token text, p_user_id uuid)
returns table (ok boolean, league_slug text, error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  select i.id           as invite_id,
         i.league_id    as league_id,
         i.expires_at   as expires_at,
         i.max_uses     as max_uses,
         i.uses_count   as uses_count,
         i.revoked      as revoked,
         l.slug         as slug
    into inv
    from league_invites i
    join leagues l on l.id = i.league_id
   where i.token = p_token
   for update of i;

  if not found or inv.revoked then
    return query select false, null::text, 'Invite is invalid or expired.'::text;
    return;
  end if;
  if inv.expires_at is not null and inv.expires_at < now() then
    return query select false, null::text, 'Invite is invalid or expired.'::text;
    return;
  end if;
  if inv.max_uses is not null and inv.uses_count >= inv.max_uses then
    return query select false, null::text, 'Invite has reached its limit.'::text;
    return;
  end if;

  insert into league_members (league_id, user_id, role)
  values (inv.league_id, p_user_id, 'member')
  on conflict (league_id, user_id) do nothing;

  update league_invites
     set uses_count = uses_count + 1
   where id = inv.invite_id;

  return query select true, inv.slug, null::text;
end;
$$;
