-- Backfill `teams.group_letter` from `matches.group_letter`.
--
-- `seedTeams()` never writes `group_letter` (football-data's /teams payload has
-- no group info), and `syncFixtures()` only writes it on the matches table.
-- That left `teams.group_letter` permanently NULL — which both
-- `GroupWinnerPicker` (app/(app)/predict/page.tsx) and `score_first_eliminated`
-- (migration 0005) read. This function derives a team's group_letter from any
-- group-stage match it appears in, and is invoked from `syncFixtures()` after
-- each match upsert. Safe to re-run.
--
-- Also acts as the recovery path for the parser bug fixed alongside this
-- migration: when `m.group` looks like `"GROUP_A"` (football-data v4 format)
-- the previous `m.group.replace("Group ", "").slice(0, 1)` returned "G" for
-- every group, so every match (and any hand-backfilled team row) ended up
-- in group G. After the parser fix, one syncFixtures run reupserts matches
-- with the correct letter; this function then propagates it to teams.

create or replace function backfill_team_group_letters()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count int;
begin
  with team_group as (
    select distinct on (team_id) team_id, group_letter
    from (
      select home_team_id as team_id, group_letter
        from matches
        where stage = 'GROUP' and group_letter is not null and home_team_id is not null
      union all
      select away_team_id as team_id, group_letter
        from matches
        where stage = 'GROUP' and group_letter is not null and away_team_id is not null
    ) m
    order by team_id, group_letter
  )
  update teams t
     set group_letter = tg.group_letter
    from team_group tg
   where t.id = tg.team_id
     and t.group_letter is distinct from tg.group_letter;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;
