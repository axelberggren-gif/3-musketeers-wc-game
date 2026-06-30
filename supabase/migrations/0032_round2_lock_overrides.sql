-- 0032_round2_lock_overrides.sql
--
-- Per-league exemption from the round-2 (knockout bracket) lock.
--
-- The bracket lock is a single global timestamp (tournament.knockout_start_at):
-- once it passes, round2_locked() is true for everyone and enforce_round2_lock()
-- (0001, made DELETE-aware in 0030) rejects all bracket_predictions writes. We
-- need to reopen the bracket for some leagues (members who hadn't picked yet)
-- while every other league stays locked — there was no per-cohort hook, so this
-- migration adds one using the dormant tournament.locked_overrides jsonb column.
--
-- Exempted leagues are listed by id in
--   tournament.locked_overrides -> 'round2_open_leagues'  (a jsonb array of uuid
--   strings).
-- A user is exempt iff they belong to at least one listed league.
--
-- round2_locked_for(uid) — SECURITY DEFINER (like is_league_member, 0008) so the
-- league_members read isn't subject to RLS when the trigger runs as the end-user
-- role. Returns: global lock passed AND the user is NOT in an exempted league.
-- enforce_round2_lock() is recreated VERBATIM from 0030 (privileged bypass +
-- DELETE handling preserved) with one change: the lock test switches from
-- round2_locked() to round2_locked_for(coalesce(new.user_id, old.user_id)) so
-- the time lock binds per-user. round2_locked() is left in place (unused now,
-- kept for back-compat). The existing trigger binds by function name, so it
-- picks up the new body — no trigger recreate needed.
--
-- To grant a league access (run once, per league):
--   update tournament
--   set locked_overrides = jsonb_set(
--     locked_overrides, '{round2_open_leagues}',
--     coalesce(locked_overrides -> 'round2_open_leagues', '[]'::jsonb)
--       || to_jsonb('<LEAGUE_UUID>'::text))
--   where id = 1;
-- To revoke, set '{round2_open_leagues}' back to '[]'::jsonb (or remove the id).
--
-- Mirrored TS-side: computeLockState(tournament, now, { round2Exempt }) and
-- isRound2Exempt() (lib/predictions/round2-access.ts) so the bracket page UI +
-- the setBracketPick* server actions match this trigger. Append-only (0001/0030
-- untouched). Schema unchanged (locked_overrides already exists) → no
-- `npm run db:types`; no point values touched → points-sync holds.

-- ---------------------------------------------------------------------------
-- Per-user round-2 lock state (global lock minus per-league exemption)
-- ---------------------------------------------------------------------------

create or replace function round2_locked_for(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select t.knockout_start_at <= now()
         and not exists (
           select 1
           from league_members lm
           where lm.user_id = uid
             and lm.league_id::text in (
               select jsonb_array_elements_text(
                 coalesce(t.locked_overrides -> 'round2_open_leagues', '[]'::jsonb)
               )
             )
         )
      from tournament t
      where t.id = 1
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- enforce_round2_lock() — verbatim 0030, lock test now per-user
-- ---------------------------------------------------------------------------

create or replace function enforce_round2_lock()
returns trigger
language plpgsql
as $$
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
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
