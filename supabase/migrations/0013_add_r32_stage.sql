-- WC 2026 expanded format adds a Round of 32 as the first knockout round
-- (12 group winners + 12 runners-up + 8 best 3rd-place = 32 advancing teams).
-- The original schema modelled the bracket as R16 → QF → SF → F, matching the
-- old 32-team WC format. This migration brings the data layer in line with the
-- actual tournament structure; the UI changes that consume it land in a
-- follow-up PR.

-- 1. Stage enum
--    Add 'R32' BEFORE 'R16' so ordinal sort goes GROUP < R32 < R16 < QF < SF < 3RD < F.
--    IF NOT EXISTS makes the migration idempotent on re-apply.
alter type stage add value if not exists 'R32' before 'R16';

-- 2. Bracket point values
--    R32 picks are worth 1 point (less prestigious than R16 = 2). Mirrored in
--    lib/scoring/rules.ts POINTS.bracket.R32.
create or replace function points_bracket_slot(slot text) returns integer
language sql immutable as $$
  select case
    when slot like 'R32-%' then 1
    when slot like 'R16-%' then 2
    when slot like 'QF-%'  then 4
    when slot like 'SF-%'  then 6
    when slot = 'F'        then 10
    when slot = 'W'        then 15
    else 0
  end;
$$;

-- 3. score_bracket() unchanged
--    The function joins bracket_predictions to matches on `bracket_slot` (text),
--    so it transparently scores R32-1..R32-16 once the matches land. No code
--    changes needed here.
