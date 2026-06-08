-- World Cup 2026 Bet Game — seven admin-resolved "house special" props.
--
-- These are the bar-bet props that football-data.org can't (or won't reliably)
-- tell us about, so the commissioner enters the actual result by hand in the
-- admin UI (/admin/props). Each is worth points_manual_prop() = 5 (mirrored in
-- lib/scoring/rules.ts as POINTS.manualProp — see lib/scoring/CLAUDE.md):
--
--   * neymar_minutes   — bool. "Will Neymar play 30 min or less, total?"
--   * streaker         — bool. "Will a streaker make it onto the pitch?"
--   * best_goalkeeper  — player. "Keeper with the most clean sheets."
--   * golden_boot_team — team. "Which nation scores the most goals?"
--   * own_goals        — int (closest guess). "How many own goals, whole cup?"
--   * war_game         — match. "Which group game collects the most cards?"
--   * swedish_players  — int (closest guess). "How many different Swedish
--                        players get any minutes?"
--
-- User picks live as new columns on tournament_predictions (so they inherit the
-- round-1 lock trigger + RLS from 0001 for free). The actual answers live in a
-- new manual_prop_resolutions table — the admin sets one row per prop_key. The
-- exact-match props (bool / team / player / match) award the full 5 pts to every
-- correct picker; the two numeric props are closest-guess (single closest wins,
-- ties split the base) exactly like score_total_goals_guess() from 0005/0020.
--
-- Scoring is a standalone score_manual_props() driver — NOT chained into
-- score_tournament() (which early-returns until the Final is FINISHED). The
-- admin "save results" action calls score_manual_props() + refresh_league_standings
-- directly, so these settle the moment the commissioner resolves them, which can
-- be long before the Final. Every sub-scorer reconciles (delete-stale-then-insert)
-- so editing a result moves the points; clearing a resolution reaps its awards.
--
-- Migrations are append-only. This adds columns + a table (run `npm run db:types`
-- once the dev DB has it; types are hand-edited meanwhile) and only `create or
-- replace`s brand-new functions, so it touches nothing 0002–0021 own.

-- ---------------------------------------------------------------------------
-- Schema: user-pick columns on tournament_predictions
-- ---------------------------------------------------------------------------

alter table tournament_predictions
  add column if not exists neymar_minutes_pick boolean,
  add column if not exists streaker_pick boolean,
  add column if not exists best_goalkeeper_player_id uuid references players(id) on delete set null,
  add column if not exists golden_boot_team_id uuid references teams(id) on delete set null,
  add column if not exists own_goals_guess integer
    check (own_goals_guess is null or own_goals_guess between 0 and 50),
  add column if not exists war_game_match_id uuid references matches(id) on delete set null,
  add column if not exists swedish_players_guess integer
    check (swedish_players_guess is null or swedish_players_guess between 0 and 50);

-- ---------------------------------------------------------------------------
-- Schema: admin-entered answers. One row per prop_key; each prop uses exactly
-- one answer_* column (the rest stay NULL). FKs are ON DELETE SET NULL so a
-- removed team/player/match just makes the prop unresolved again rather than
-- vanishing the row.
-- ---------------------------------------------------------------------------

create table if not exists manual_prop_resolutions (
  prop_key text primary key,
  answer_bool boolean,
  answer_int integer,
  answer_team_id uuid references teams(id) on delete set null,
  answer_player_id uuid references players(id) on delete set null,
  answer_match_id uuid references matches(id) on delete set null,
  resolved_at timestamptz not null default now(),
  resolved_by uuid references profiles(id) on delete set null
);

alter table manual_prop_resolutions enable row level security;
-- Readable by any authenticated user (the answers are public once set); writes
-- only happen through the service-role admin action, which bypasses RLS.
drop policy if exists "mpr_read" on manual_prop_resolutions;
create policy "mpr_read" on manual_prop_resolutions for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Point constant (kept in sync with POINTS.manualProp in lib/scoring/rules.ts)
-- ---------------------------------------------------------------------------

create or replace function points_manual_prop() returns integer language sql immutable as $$ select 5 $$;

-- ---------------------------------------------------------------------------
-- Exact-match scorers. Each awards points_manual_prop() to every user whose
-- pick equals the resolved answer; reconcile drops awards whose pick no longer
-- matches (or whose resolution was cleared). The boolean ones distinguish
-- "unresolved" (NULL) from a resolved "no" (false).
-- ---------------------------------------------------------------------------

create or replace function score_neymar_minutes()
returns integer language plpgsql security definer set search_path = public as $$
declare ans boolean; awarded int := 0;
begin
  select answer_bool into ans from manual_prop_resolutions where prop_key = 'neymar_minutes';
  if ans is null then
    delete from point_awards where idempotency_key like 'manual:neymar_minutes:%';
    return 0;
  end if;
  delete from point_awards pa
  where pa.idempotency_key like 'manual:neymar_minutes:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'manual:neymar_minutes:' || tp.user_id::text
        and tp.neymar_minutes_pick = ans
    );
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_manual_prop(),
         'manual:neymar_minutes:' || tp.user_id::text
  from tournament_predictions tp
  where tp.neymar_minutes_pick = ans
  on conflict (idempotency_key) do nothing;
  get diagnostics awarded = row_count;
  return awarded;
end; $$;

create or replace function score_streaker()
returns integer language plpgsql security definer set search_path = public as $$
declare ans boolean; awarded int := 0;
begin
  select answer_bool into ans from manual_prop_resolutions where prop_key = 'streaker';
  if ans is null then
    delete from point_awards where idempotency_key like 'manual:streaker:%';
    return 0;
  end if;
  delete from point_awards pa
  where pa.idempotency_key like 'manual:streaker:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'manual:streaker:' || tp.user_id::text
        and tp.streaker_pick = ans
    );
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_manual_prop(),
         'manual:streaker:' || tp.user_id::text
  from tournament_predictions tp
  where tp.streaker_pick = ans
  on conflict (idempotency_key) do nothing;
  get diagnostics awarded = row_count;
  return awarded;
end; $$;

create or replace function score_best_goalkeeper()
returns integer language plpgsql security definer set search_path = public as $$
declare ans uuid; awarded int := 0;
begin
  select answer_player_id into ans from manual_prop_resolutions where prop_key = 'best_goalkeeper';
  if ans is null then
    delete from point_awards where idempotency_key like 'manual:best_goalkeeper:%';
    return 0;
  end if;
  delete from point_awards pa
  where pa.idempotency_key like 'manual:best_goalkeeper:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'manual:best_goalkeeper:' || tp.user_id::text
        and tp.best_goalkeeper_player_id = ans
    );
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_manual_prop(),
         'manual:best_goalkeeper:' || tp.user_id::text
  from tournament_predictions tp
  where tp.best_goalkeeper_player_id = ans
  on conflict (idempotency_key) do nothing;
  get diagnostics awarded = row_count;
  return awarded;
end; $$;

create or replace function score_golden_boot_team()
returns integer language plpgsql security definer set search_path = public as $$
declare ans uuid; awarded int := 0;
begin
  select answer_team_id into ans from manual_prop_resolutions where prop_key = 'golden_boot_team';
  if ans is null then
    delete from point_awards where idempotency_key like 'manual:golden_boot_team:%';
    return 0;
  end if;
  delete from point_awards pa
  where pa.idempotency_key like 'manual:golden_boot_team:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'manual:golden_boot_team:' || tp.user_id::text
        and tp.golden_boot_team_id = ans
    );
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_manual_prop(),
         'manual:golden_boot_team:' || tp.user_id::text
  from tournament_predictions tp
  where tp.golden_boot_team_id = ans
  on conflict (idempotency_key) do nothing;
  get diagnostics awarded = row_count;
  return awarded;
end; $$;

create or replace function score_war_game()
returns integer language plpgsql security definer set search_path = public as $$
declare ans uuid; awarded int := 0;
begin
  select answer_match_id into ans from manual_prop_resolutions where prop_key = 'war_game';
  if ans is null then
    delete from point_awards where idempotency_key like 'manual:war_game:%';
    return 0;
  end if;
  delete from point_awards pa
  where pa.idempotency_key like 'manual:war_game:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'manual:war_game:' || tp.user_id::text
        and tp.war_game_match_id = ans
    );
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_manual_prop(),
         'manual:war_game:' || tp.user_id::text
  from tournament_predictions tp
  where tp.war_game_match_id = ans
  on conflict (idempotency_key) do nothing;
  get diagnostics awarded = row_count;
  return awarded;
end; $$;

-- ---------------------------------------------------------------------------
-- Closest-guess numeric scorers — single closest wins, ties split the base
-- (floor(base / n_tied), min 1). Cloned from score_total_goals_guess() with the
-- points-aware reconcile predicate (both membership AND the split value can move
-- when the answer is corrected). actual = the admin-entered answer_int.
-- ---------------------------------------------------------------------------

create or replace function score_own_goals_guess()
returns integer language plpgsql security definer set search_path = public as $$
declare actual int; min_delta int; n_tied int; per_user int; awarded int := 0;
begin
  select answer_int into actual from manual_prop_resolutions where prop_key = 'own_goals';
  if actual is null then
    delete from point_awards where idempotency_key like 'manual:own_goals:%';
    return 0;
  end if;

  select min(abs(own_goals_guess - actual)) into min_delta
    from tournament_predictions where own_goals_guess is not null;
  if min_delta is null then
    delete from point_awards where idempotency_key like 'manual:own_goals:%';
    return 0;
  end if;

  select count(*) into n_tied
    from tournament_predictions
    where own_goals_guess is not null and abs(own_goals_guess - actual) = min_delta;
  per_user := greatest(1, (points_manual_prop() / n_tied)::int);

  delete from point_awards pa
  where pa.idempotency_key like 'manual:own_goals:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'manual:own_goals:' || tp.user_id::text
        and tp.own_goals_guess is not null
        and abs(tp.own_goals_guess - actual) = min_delta
        and pa.points = per_user
    );
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, per_user, 'manual:own_goals:' || tp.user_id::text
  from tournament_predictions tp
  where tp.own_goals_guess is not null and abs(tp.own_goals_guess - actual) = min_delta
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end; $$;

create or replace function score_swedish_players_guess()
returns integer language plpgsql security definer set search_path = public as $$
declare actual int; min_delta int; n_tied int; per_user int; awarded int := 0;
begin
  select answer_int into actual from manual_prop_resolutions where prop_key = 'swedish_players';
  if actual is null then
    delete from point_awards where idempotency_key like 'manual:swedish_players:%';
    return 0;
  end if;

  select min(abs(swedish_players_guess - actual)) into min_delta
    from tournament_predictions where swedish_players_guess is not null;
  if min_delta is null then
    delete from point_awards where idempotency_key like 'manual:swedish_players:%';
    return 0;
  end if;

  select count(*) into n_tied
    from tournament_predictions
    where swedish_players_guess is not null and abs(swedish_players_guess - actual) = min_delta;
  per_user := greatest(1, (points_manual_prop() / n_tied)::int);

  delete from point_awards pa
  where pa.idempotency_key like 'manual:swedish_players:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'manual:swedish_players:' || tp.user_id::text
        and tp.swedish_players_guess is not null
        and abs(tp.swedish_players_guess - actual) = min_delta
        and pa.points = per_user
    );
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, per_user, 'manual:swedish_players:' || tp.user_id::text
  from tournament_predictions tp
  where tp.swedish_players_guess is not null and abs(tp.swedish_players_guess - actual) = min_delta
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end; $$;

-- ---------------------------------------------------------------------------
-- score_manual_props() — driver. Each sub-scorer reconciles internally and is a
-- no-op when its prop is unresolved, so this is safe to re-run any time. Called
-- from the admin "save results" action after writing manual_prop_resolutions.
-- ---------------------------------------------------------------------------

create or replace function score_manual_props()
returns integer language plpgsql security definer set search_path = public as $$
declare awarded int := 0;
begin
  awarded := awarded + score_neymar_minutes();
  awarded := awarded + score_streaker();
  awarded := awarded + score_best_goalkeeper();
  awarded := awarded + score_golden_boot_team();
  awarded := awarded + score_war_game();
  awarded := awarded + score_own_goals_guess();
  awarded := awarded + score_swedish_players_guess();
  return awarded;
end; $$;
