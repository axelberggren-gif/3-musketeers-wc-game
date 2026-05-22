-- The 0006 fix to `league_members_read_self_leagues` wasn't enough — users
-- still hit "League created but not visible to you" on production. Add a
-- direct owner base case to `leagues_read_members` so the creator of a
-- league can always read it back regardless of how the EXISTS subquery
-- against `league_members` resolves. The original member-visibility branch
-- is preserved for non-owner members.

drop policy if exists "leagues_read_members" on leagues;
create policy "leagues_read_members" on leagues
  for select to authenticated using (
    owner_id = auth.uid()
    or exists (
      select 1 from league_members lm
      where lm.league_id = leagues.id and lm.user_id = auth.uid()
    )
  );

-- Diagnostic helper: returns the auth.uid() that PostgREST sees for the
-- caller's JWT. Used by the createLeague server action to compare against
-- the Next.js-side `user.id` when the visibility check still fails — if
-- they differ, we know the JWT/session is the problem, not the policy.
create or replace function debug_auth_uid()
returns uuid
language sql
security invoker
stable
as $$ select auth.uid() $$;

grant execute on function debug_auth_uid() to authenticated, anon;
