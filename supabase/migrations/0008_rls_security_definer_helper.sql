-- Sentry confirmed (event 122257777): the OR'd `user_id = auth.uid()`
-- bootstrap from 0006 did NOT actually break the recursion. Postgres'
-- RLS recursion detector evaluates the OR'd EXISTS subquery regardless
-- of whether the first OR branch short-circuits to true, and the
-- EXISTS still references league_members from inside league_members'
-- own policy — which raises `infinite recursion detected in policy for
-- relation "league_members"` (not a silent false, as we'd hoped).
--
-- The 0007 owner base case on leagues_read_members hit the same fate
-- via its EXISTS on league_members.
--
-- Fix: move the membership check into a SECURITY DEFINER function. The
-- function runs as the owner (postgres) and therefore bypasses RLS on
-- its inner query, so the policy can reference league_members through
-- the helper without recursing.

create or replace function is_league_member(p_league_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from league_members
    where league_id = p_league_id and user_id = p_user_id
  );
$$;

grant execute on function is_league_member(uuid, uuid) to authenticated, anon;

-- league_members read policy: own row OR same-league fellow member.
-- The fellow-member case routes through is_league_member to avoid
-- recursing on league_members.
drop policy if exists "league_members_read_self_leagues" on league_members;
create policy "league_members_read_self_leagues" on league_members
  for select to authenticated using (
    user_id = auth.uid()
    or is_league_member(league_id, auth.uid())
  );

-- leagues read policy: owner OR member. Same fix — route the member
-- check through is_league_member so the EXISTS-on-league_members no
-- longer trips the recursion detector indirectly.
drop policy if exists "leagues_read_members" on leagues;
create policy "leagues_read_members" on leagues
  for select to authenticated using (
    owner_id = auth.uid()
    or is_league_member(id, auth.uid())
  );
