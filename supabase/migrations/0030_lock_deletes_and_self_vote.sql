-- 0030_lock_deletes_and_self_vote.sql
--
-- (a) Make the round-lock triggers cover DELETE.
--
-- enforce_round1_lock / enforce_round2_lock (0001_init.sql) fire on
-- INSERT OR UPDATE only, while the *_write_self RLS policies are `for all` —
-- so a user could hand-craft a PostgREST DELETE of their own pick after lock.
-- "Picks are immutable after lock" must include removals: deleting a pick is
-- information too (e.g. wiping a doomed bracket pick the moment its team is
-- knocked out, or clearing a 1X2 pick that's about to score 0).
--
-- The replaced trigger functions handle TG_OP = 'DELETE' (raise the same
-- exception when locked; `return old` on the allow path — `return new` would
-- be NULL on DELETE and silently skip the row) and BYPASS the lock check for
-- privileged executors. Why the bypass: triggers — unlike RLS — fire for
-- every role, including service_role, and legitimate post-lock deletes exist:
--   * removeLeagueMember (lib/leagues/actions.ts) deletes a removed member's
--     league_group_bets rows via the service-role client, possibly mid-
--     tournament (after round-1 lock).
--   * FK ON DELETE CASCADE ripples (deleting an auth.users row cascades
--     profiles → match/bracket/tournament/player-prop predictions +
--     league_group_bets; deleting a league cascades league_group_bets). RI
--     cascade queries execute as the owner of the referencing table
--     (`postgres` on Supabase), and the row triggers they fire must not abort
--     the cascade.
-- Role detection: `current_user` is the role actually executing the DML —
-- PostgREST switches to `service_role` for service-key requests, direct
-- connections (migrations, dashboard SQL editor, pg_cron) run as `postgres` /
-- `supabase_admin`, and cascades run as the table owner (`postgres`). The
-- JWT-claims probe (`request.jwt.claims ->> 'role'`, NULL-safe via
-- current_setting(..., true)) is belt-and-braces for any context where the
-- GUC is set but the executing role differs. End users always arrive as
-- `authenticated` (or `anon`), so the lock still binds them.
--
-- The five lock triggers are recreated under their exact existing names as
-- BEFORE INSERT OR UPDATE OR DELETE (drop-if-exists first → idempotent):
-- round 1 on match_predictions / tournament_predictions /
-- player_prop_predictions (0001) + league_group_bets (0023); round 2 on
-- bracket_predictions (0001). (0005's group_winner_predictions trigger died
-- with its table in 0021.)
--
-- (b) Close the self-vote gap on league_group_bets.
--
-- lgb_write_self (0023) required voter + votee to both be league members but
-- never voter <> votee, so a hand-crafted PostgREST write could vote for
-- yourself (the setLeagueBet server action blocks it; the DB didn't).
-- Recreated verbatim with `votee_id <> auth.uid()` added to WITH CHECK.
--
-- Append-only (0001/0023 untouched), idempotent re-apply, no schema change →
-- no `npm run db:types`; no point values touched.

-- ---------------------------------------------------------------------------
-- (a) Lock trigger functions — now DELETE-aware, with privileged bypass
-- ---------------------------------------------------------------------------

create or replace function enforce_round1_lock()
returns trigger
language plpgsql
as $$
begin
  -- Privileged bypass (service-role cleanup, migrations, FK cascades) — see
  -- the header comment. RLS still governs what end users can touch; this
  -- trigger only enforces the time lock, which doesn't apply to housekeeping.
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role')
     or nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' = 'service_role'
  then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if round1_locked() then
    raise exception 'Round 1 picks are locked (tournament has started).'
      using errcode = '40004';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function enforce_round2_lock()
returns trigger
language plpgsql
as $$
begin
  -- Privileged bypass — same rationale as enforce_round1_lock() above.
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role')
     or nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' = 'service_role'
  then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if round2_locked() then
    raise exception 'Round 2 bracket picks are locked (knockouts have started).'
      using errcode = '40004';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- (a) Recreate the five lock triggers to also fire on DELETE
-- ---------------------------------------------------------------------------

drop trigger if exists match_predictions_lock on match_predictions;
create trigger match_predictions_lock
  before insert or update or delete on match_predictions
  for each row execute function enforce_round1_lock();

drop trigger if exists tournament_predictions_lock on tournament_predictions;
create trigger tournament_predictions_lock
  before insert or update or delete on tournament_predictions
  for each row execute function enforce_round1_lock();

drop trigger if exists player_prop_predictions_lock on player_prop_predictions;
create trigger player_prop_predictions_lock
  before insert or update or delete on player_prop_predictions
  for each row execute function enforce_round1_lock();

drop trigger if exists league_group_bets_lock on league_group_bets;
create trigger league_group_bets_lock
  before insert or update or delete on league_group_bets
  for each row execute function enforce_round1_lock();

drop trigger if exists bracket_predictions_lock on bracket_predictions;
create trigger bracket_predictions_lock
  before insert or update or delete on bracket_predictions
  for each row execute function enforce_round2_lock();

-- ---------------------------------------------------------------------------
-- (b) lgb_write_self — verbatim 0023 plus the no-self-vote check
-- ---------------------------------------------------------------------------

drop policy if exists "lgb_write_self" on league_group_bets;
create policy "lgb_write_self" on league_group_bets
  for all to authenticated
  using (voter_id = auth.uid())
  with check (
    voter_id = auth.uid()
    and votee_id <> auth.uid()
    and is_league_member(league_id, auth.uid())
    and is_league_member(league_id, votee_id)
  );
