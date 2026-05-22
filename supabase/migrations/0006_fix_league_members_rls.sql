-- Fix: the leagues_read_members RLS policy's EXISTS check against
-- league_members couldn't see the user's own freshly-inserted membership row
-- because league_members_read_self_leagues was self-referential — to see a
-- row you had to see another row for the same league. Postgres' RLS
-- recursion-breaker returns false in that situation, so the creator of a
-- brand-new league couldn't read it back and the slug page 404'd.
--
-- Fix: add a `user_id = auth.uid()` bootstrap clause so a user can always
-- read their own membership rows. The original EXISTS branch still lets
-- members of the same league see each other's rows.

drop policy if exists "league_members_read_self_leagues" on league_members;
create policy "league_members_read_self_leagues" on league_members
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from league_members me
      where me.league_id = league_members.league_id and me.user_id = auth.uid()
    )
  );
