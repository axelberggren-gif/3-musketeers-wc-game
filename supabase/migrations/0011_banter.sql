-- Banter: per-league chat (top-level messages + threaded replies) for the
-- league home screen. Per DESIGN_MISALIGNMENTS.md §1 the Banter sticker is
-- the social heartbeat of the league screen and the only "talk shit to your
-- friends" surface; this migration adds the storage layer + RLS so the
-- BanterFeed client component can stream messages in real time.
--
-- Two tables, mirrored RLS, hard 1..180 char body limit (also enforced
-- client-side and in the server action — DB CHECK is the backstop).
--
-- Membership is gated by the existing `is_league_member(uuid, uuid)`
-- SECURITY DEFINER helper from 0008. Because `banter_replies` has no
-- `league_id` column (it's derived through the parent message), this
-- migration adds a small companion helper `banter_message_league_id(uuid)`
-- so reply policies can compose: is_league_member(banter_message_league_id(message_id), auth.uid()).
-- Doing the lookup in a SECURITY DEFINER function keeps the policy from
-- depending on RLS on banter_messages (which would otherwise need to be
-- evaluated against the same user during the policy check on banter_replies).
--
-- Realtime: both tables are added to the `supabase_realtime` publication so
-- the client channel `league:<id>:banter` receives INSERT/DELETE events.
-- The duplicate_object swallow makes the publication step a no-op on re-apply.

create table if not exists banter_messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 180),
  created_at timestamptz not null default now()
);

create index if not exists banter_messages_league_created_idx
  on banter_messages (league_id, created_at desc);

create table if not exists banter_replies (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references banter_messages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 180),
  created_at timestamptz not null default now()
);

create index if not exists banter_replies_message_created_idx
  on banter_replies (message_id, created_at asc);

create or replace function banter_message_league_id(p_message_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select league_id from banter_messages where id = p_message_id
$$;

grant execute on function banter_message_league_id(uuid) to authenticated, anon;

alter table banter_messages enable row level security;
alter table banter_replies enable row level security;

drop policy if exists "banter_messages_read_members" on banter_messages;
create policy "banter_messages_read_members" on banter_messages
  for select to authenticated using (
    is_league_member(league_id, auth.uid())
  );

drop policy if exists "banter_messages_insert_self" on banter_messages;
create policy "banter_messages_insert_self" on banter_messages
  for insert to authenticated with check (
    user_id = auth.uid()
    and is_league_member(league_id, auth.uid())
  );

drop policy if exists "banter_messages_delete_author" on banter_messages;
create policy "banter_messages_delete_author" on banter_messages
  for delete to authenticated using (
    user_id = auth.uid()
  );

drop policy if exists "banter_replies_read_members" on banter_replies;
create policy "banter_replies_read_members" on banter_replies
  for select to authenticated using (
    is_league_member(banter_message_league_id(message_id), auth.uid())
  );

drop policy if exists "banter_replies_insert_self" on banter_replies;
create policy "banter_replies_insert_self" on banter_replies
  for insert to authenticated with check (
    user_id = auth.uid()
    and is_league_member(banter_message_league_id(message_id), auth.uid())
  );

drop policy if exists "banter_replies_delete_author" on banter_replies;
create policy "banter_replies_delete_author" on banter_replies
  for delete to authenticated using (
    user_id = auth.uid()
  );

do $$
begin
  alter publication supabase_realtime add table banter_messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table banter_replies;
exception when duplicate_object then null;
end $$;
