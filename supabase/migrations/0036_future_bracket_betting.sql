-- 0036_future_bracket_betting.sql
--
-- Per-slot "future betting" for leagues with the round-2 bracket exemption.
--
-- Migration 0032 reopened the whole bracket for leagues listed in
-- tournament.locked_overrides -> 'round2_open_leagues' — including slots whose
-- real match had already been PLAYED. That's an exploit for a reopened league:
-- once the knockouts are underway, a member could set (or fix) a pick on a
-- FINISHED match with the result already known and bank the points on the next
-- score_bracket() run. 0033 closed all leagues again; this migration makes the
-- exemption safe to grant mid-knockouts by tightening the trigger:
--
-- For an exempt user PAST the global knockout lock, a bracket_predictions write
-- is allowed only when ALL of:
--   (1) the slot's real match has NOT kicked off (kickoff_at > now(), and not
--       LIVE/FINISHED) — played and in-play matches stay locked, including
--       deletes (a settled bet can't be wiped). A slot with no imported match
--       yet (future round still unscheduled) counts as not started.
--       The `W` (champion) slot is backed by the Final ('F') match.
--   (2) for INSERT/UPDATE, the picked team has actually advanced:
--       (a) when the slot's real match knows both teams, the pick must be one
--           of them, and
--       (b) the team must not already be knocked out (lost a FINISHED
--           knockout-stage match — GROUP and 3RD excluded).
--       Slots whose real pairing isn't known yet can't be fully validated at
--       the DB level (the exact tree walk lives in the UI); (b) still blocks
--       every already-eliminated team.
--
-- Behaviour BEFORE the global knockout lock is unchanged (free build phase —
-- nothing has been played), and non-exempt users past the lock are rejected
-- exactly as before via round2_locked_for(). Privileged bypass (service-role
-- cleanup, migrations, FK cascades) preserved verbatim from 0030/0032.
--
-- New SECURITY DEFINER helpers (same rationale as round2_locked_for, 0032: the
-- trigger runs as the end-user role and `matches` reads must not depend on that
-- role's RLS): bracket_slot_started(slot), bracket_pick_team_allowed(slot, team).
--
-- Which leagues are open is now managed from the admin UI
-- (/admin/leagues → setLeagueBracketFutureAccess in lib/admin/actions.ts),
-- writing the same locked_overrides jsonb array 0032 defined — no more
-- one-off data migrations to open/close a league.
--
-- Mirrored TS-side: the setBracketPick* actions run the same per-slot checks
-- (lib/predictions/actions.ts), and BracketBuilder's new "futures" mode only
-- offers unplayed slots + advanced teams. Append-only (0001/0030/0032/0033
-- untouched); the bracket_predictions trigger binds by function name so no
-- trigger recreate. No schema change → no `npm run db:types`; no point values
-- touched → points-sync holds.

-- ---------------------------------------------------------------------------
-- Has the real match backing a bracket slot started? ('W' is backed by 'F'.)
-- ---------------------------------------------------------------------------

create or replace function bracket_slot_started(p_slot text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select m.kickoff_at <= now() or m.status in ('LIVE', 'FINISHED')
      from matches m
      where m.bracket_slot = case when p_slot = 'W' then 'F' else p_slot end
      order by m.kickoff_at
      limit 1
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Is a team a legitimate pick for a slot? (advancement checks (a) + (b))
-- ---------------------------------------------------------------------------

create or replace function bracket_pick_team_allowed(p_slot text, p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- (a) the slot's real match knows both contestants → must be one of them.
    coalesce(
      (
        select p_team in (m.home_team_id, m.away_team_id)
        from matches m
        where m.bracket_slot = case when p_slot = 'W' then 'F' else p_slot end
          and m.home_team_id is not null
          and m.away_team_id is not null
        order by m.kickoff_at
        limit 1
      ),
      true
    )
    -- (b) never a team already knocked out (lost a FINISHED knockout match;
    --     the 3RD-place playoff isn't elimination and GROUP has no knockouts).
    and not exists (
      select 1
      from matches mx
      where mx.stage in ('R32', 'R16', 'QF', 'SF', 'F')
        and mx.status = 'FINISHED'
        and (
          (mx.winner = 'HOME' and mx.away_team_id = p_team)
          or (mx.winner = 'AWAY' and mx.home_team_id = p_team)
        )
    );
$$;

-- ---------------------------------------------------------------------------
-- enforce_round2_lock() — verbatim 0032 plus the per-slot future-betting rules
-- ---------------------------------------------------------------------------

create or replace function enforce_round2_lock()
returns trigger
language plpgsql
as $$
declare
  v_slot text := coalesce(new.bracket_slot, old.bracket_slot);
begin
  -- Privileged bypass (service-role cleanup, migrations, FK cascades) — see the
  -- header comment in 0030. RLS still governs what end users can touch; this
  -- trigger only enforces the time lock, which doesn't apply to housekeeping.
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role')
     or nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' = 'service_role'
  then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- Per-user: a member of an exempted league (locked_overrides.round2_open_leagues)
  -- stays unlocked past the global knockout start. Everyone else is locked.
  if round2_locked_for(coalesce(new.user_id, old.user_id)) then
    raise exception 'Round 2 bracket picks are locked (knockouts have started).'
      using errcode = '40004';
  end if;

  -- Past the global knockout start we're only here because of the per-league
  -- exemption — that's the FUTURE-BETTING window: played/in-play matches stay
  -- locked and picks must be teams that actually advanced.
  if round2_locked() then
    if bracket_slot_started(v_slot) then
      raise exception 'This match has already started — future bets only.'
        using errcode = '40004';
    end if;
    if tg_op in ('INSERT', 'UPDATE')
       and not bracket_pick_team_allowed(v_slot, new.team_id)
    then
      raise exception 'That team has not advanced to this match.'
        using errcode = '40004';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
