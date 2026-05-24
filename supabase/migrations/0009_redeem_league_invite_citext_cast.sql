-- 2026-05-24  Fix redeem_league_invite() returning citext where text was declared.
--
-- The success path returned inv.slug (leagues.slug is citext) into a result
-- column declared `league_slug text`, which Postgres rejects at runtime with
--   42804: structure of query does not match function result type
--   detail: Returned type citext does not match expected type text in column 2.
--
-- Cast the slug to text in the success-path SELECT so the runtime column type
-- matches the function's declared return type. No signature change, so existing
-- PostgREST callers and the supabase-js .rpc() invocation in
-- lib/auth/invite.ts work unchanged.

create or replace function redeem_league_invite(p_token text, p_user_id uuid)
returns table (ok boolean, league_slug text, error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  select i.id           as invite_id,
         i.league_id    as league_id,
         i.expires_at   as expires_at,
         i.max_uses     as max_uses,
         i.uses_count   as uses_count,
         i.revoked      as revoked,
         l.slug         as slug
    into inv
    from league_invites i
    join leagues l on l.id = i.league_id
   where i.token = p_token
   for update of i;

  if not found or inv.revoked then
    return query select false, null::text, 'Invite is invalid or expired.'::text;
    return;
  end if;
  if inv.expires_at is not null and inv.expires_at < now() then
    return query select false, null::text, 'Invite is invalid or expired.'::text;
    return;
  end if;
  if inv.max_uses is not null and inv.uses_count >= inv.max_uses then
    return query select false, null::text, 'Invite has reached its limit.'::text;
    return;
  end if;

  insert into league_members (league_id, user_id, role)
  values (inv.league_id, p_user_id, 'member')
  on conflict (league_id, user_id) do nothing;

  update league_invites
     set uses_count = uses_count + 1
   where id = inv.invite_id;

  return query select true, inv.slug::text, null::text;
end;
$$;
