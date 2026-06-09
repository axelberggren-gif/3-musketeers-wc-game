-- 0029_backfill_fifa_rankings.sql
--
-- Self-healing FIFA-ranking seed. Nothing in TS ever writes
-- `teams.fifa_ranking` — the only writer was the one-shot UPDATE block at the
-- bottom of 0005_more_tournament_props.sql (keyed on `teams.code`). On a fresh
-- deploy the normal order is "apply migrations, then seedTeams()", so every
-- team row is created AFTER 0005's UPDATEs ran against an empty table:
-- `fifa_ranking` stays NULL, the dark-horse picker loses its rank sort, and
-- the rank-based dark-horse scoring (live score_tournament() requires
-- `t.fifa_ranking is not null`) silently pays nobody.
--
-- Fix: a callable backfill RPC, mirroring backfill_team_group_letters()
-- (0010), that upserts all 48 code → rank pairs in a single
-- UPDATE ... FROM (VALUES ...). The pairs exactly mirror FIFA_RANKINGS_2026
-- in lib/scoring/fifa-rankings.ts — the canonical TS source (also what 0005's
-- seed mirrors; rank changes still require a new migration updating both).
-- Invoked from seedTeams() after the team upsert and from syncFixtures()
-- alongside the backfill_team_group_letters call, so rankings self-heal on
-- every sync at zero football-data API cost. The trailing SELECT heals any
-- already-seeded rows the moment this migration applies.
--
-- Idempotent: `is distinct from` makes a re-run (or re-apply) a zero-row
-- no-op. Append-only — 0005 untouched. No schema change → no `npm run
-- db:types` (types.ts hand-gains the RPC meanwhile; the CLI reproduces it
-- once the dev DB applies this); no point values touched.

create or replace function backfill_team_fifa_rankings()
returns void
language sql
security definer
set search_path = public
as $$
  update teams
     set fifa_ranking = v.rank
    from (values
    ('ARG',  1),
    ('FRA',  2),
    ('ESP',  3),
    ('ENG',  4),
    ('BRA',  5),
    ('NED',  6),
    ('POR',  7),
    ('BEL',  8),
    ('GER',  9),
    ('CRO', 10),
    ('COL', 11),
    ('URU', 12),
    ('JPN', 13),
    ('MAR', 14),
    ('USA', 15),
    ('SUI', 16),
    ('SEN', 17),
    ('MEX', 18),
    ('IRN', 19),
    ('DEN', 20),
    ('KOR', 21),
    ('AUT', 22),
    ('AUS', 23),
    ('ECU', 24),
    ('UKR', 25),
    ('CRC', 26),
    ('CIV', 27),
    ('POL', 28),
    ('EGY', 29),
    ('NOR', 30),
    ('NGA', 31),
    ('CAN', 32),
    ('ALG', 33),
    ('SCO', 34),
    ('SRB', 35),
    ('ROU', 36),
    ('CZE', 37),
    ('PAR', 38),
    ('QAT', 39),
    ('KSA', 40),
    ('SVK', 41),
    ('COD', 42),
    ('TUN', 43),
    ('JAM', 44),
    ('UZB', 45),
    ('JOR', 46),
    ('NZL', 47),
    ('CPV', 48)
    ) as v(code, rank)
   where teams.code = v.code
     and (teams.fifa_ranking is distinct from v.rank);
$$;

-- Heal existing rows immediately on apply (no-op on an empty teams table —
-- the sync wiring covers teams seeded later).
select backfill_team_fifa_rankings();
