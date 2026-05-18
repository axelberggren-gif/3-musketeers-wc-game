-- World Cup 2026 Bet Game — initial schema, RLS, and lock triggers.
--
-- Run with `supabase db reset` against a local project, or apply via the
-- Supabase dashboard SQL editor on the hosted project.

create extension if not exists "citext";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------

do $$ begin
  create type stage as enum ('GROUP', 'R16', 'QF', 'SF', '3RD', 'F');
exception when duplicate_object then null; end $$;

do $$ begin
  create type match_status as enum ('SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pick_1x2 as enum ('HOME', 'DRAW', 'AWAY');
exception when duplicate_object then null; end $$;

do $$ begin
  create type winner as enum ('HOME', 'DRAW', 'AWAY');
exception when duplicate_object then null; end $$;

do $$ begin
  create type prediction_type as enum ('match', 'bracket', 'tournament', 'prop');
exception when duplicate_object then null; end $$;

do $$ begin
  create type league_role as enum ('owner', 'member');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext unique not null,
  display_name text,
  avatar_url text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists profiles_username_idx on profiles (username);

-- ---------------------------------------------------------------------------
-- Leagues + membership
-- ---------------------------------------------------------------------------

create table if not exists leagues (
  id uuid primary key default gen_random_uuid(),
  slug citext unique not null,
  name text not null,
  owner_id uuid not null references profiles(id) on delete restrict,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists league_members (
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role league_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create index if not exists league_members_user_idx on league_members (user_id);

create table if not exists league_invites (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  token text unique not null,
  expires_at timestamptz,
  max_uses integer,
  uses_count integer not null default 0,
  revoked boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists league_invites_token_idx on league_invites (token);

-- ---------------------------------------------------------------------------
-- Tournament config (single row)
-- ---------------------------------------------------------------------------

create table if not exists tournament (
  id integer primary key default 1 check (id = 1),
  first_kickoff_at timestamptz not null,
  knockout_start_at timestamptz not null,
  final_at timestamptz not null,
  locked_overrides jsonb not null default '{}'::jsonb
);

-- Seed with 2026 World Cup dates (USA/Canada/Mexico).
-- Adjust via admin once the official schedule is final.
insert into tournament (id, first_kickoff_at, knockout_start_at, final_at)
values (
  1,
  '2026-06-11 20:00:00+00',
  '2026-07-04 16:00:00+00',
  '2026-07-19 19:00:00+00'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Teams, players, matches
-- ---------------------------------------------------------------------------

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  external_id integer unique,
  name text not null,
  short_name text,
  code text not null,
  crest_url text,
  group_letter char(1),
  created_at timestamptz not null default now()
);

create index if not exists teams_group_idx on teams (group_letter);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  external_id integer unique,
  name text not null,
  team_id uuid references teams(id) on delete set null,
  position text,
  created_at timestamptz not null default now()
);

create index if not exists players_team_idx on players (team_id);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  external_id integer unique,
  stage stage not null,
  group_letter char(1),
  bracket_slot text,
  kickoff_at timestamptz not null,
  home_team_id uuid references teams(id) on delete set null,
  away_team_id uuid references teams(id) on delete set null,
  status match_status not null default 'SCHEDULED',
  home_score integer,
  away_score integer,
  winner winner,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists matches_kickoff_idx on matches (kickoff_at);
create index if not exists matches_stage_idx on matches (stage);
create index if not exists matches_status_idx on matches (status);

-- ---------------------------------------------------------------------------
-- Predictions
-- ---------------------------------------------------------------------------

create table if not exists match_predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  match_id uuid not null references matches(id) on delete cascade,
  pick pick_1x2 not null,
  submitted_at timestamptz not null default now(),
  unique (user_id, match_id)
);

create index if not exists match_predictions_match_idx on match_predictions (match_id);

create table if not exists bracket_predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  bracket_slot text not null,
  team_id uuid not null references teams(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  unique (user_id, bracket_slot)
);

create index if not exists bracket_predictions_slot_idx on bracket_predictions (bracket_slot);

create table if not exists tournament_predictions (
  user_id uuid primary key references profiles(id) on delete cascade,
  winner_team_id uuid references teams(id),
  runner_up_team_id uuid references teams(id),
  top_scorer_player_id uuid references players(id),
  dark_horse_team_id uuid references teams(id),
  submitted_at timestamptz not null default now()
);

create table if not exists player_prop_predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  prop_key text not null,
  player_id uuid not null references players(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  unique (user_id, prop_key)
);

-- ---------------------------------------------------------------------------
-- Point awards
-- ---------------------------------------------------------------------------

create table if not exists point_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  prediction_type prediction_type not null,
  prediction_ref uuid,
  match_id uuid references matches(id) on delete set null,
  points integer not null,
  idempotency_key text unique not null,
  awarded_at timestamptz not null default now()
);

create index if not exists point_awards_user_idx on point_awards (user_id);
create index if not exists point_awards_match_idx on point_awards (match_id);

-- ---------------------------------------------------------------------------
-- External sync log (for debugging API pulls)
-- ---------------------------------------------------------------------------

create table if not exists external_sync_log (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  endpoint text not null,
  status_code integer,
  message text,
  payload jsonb,
  ran_at timestamptz not null default now()
);

create index if not exists external_sync_log_ran_at_idx on external_sync_log (ran_at desc);

-- ---------------------------------------------------------------------------
-- Lock helpers
-- ---------------------------------------------------------------------------

create or replace function tournament_locks()
returns table (first_kickoff_at timestamptz, knockout_start_at timestamptz)
language sql
stable
as $$
  select first_kickoff_at, knockout_start_at from tournament where id = 1;
$$;

create or replace function round1_locked()
returns boolean
language sql
stable
as $$
  select coalesce((select first_kickoff_at <= now() from tournament where id = 1), false);
$$;

create or replace function round2_locked()
returns boolean
language sql
stable
as $$
  select coalesce((select knockout_start_at <= now() from tournament where id = 1), false);
$$;

-- ---------------------------------------------------------------------------
-- Lock triggers — reject writes after the relevant lock time
-- ---------------------------------------------------------------------------

create or replace function enforce_round1_lock()
returns trigger
language plpgsql
as $$
begin
  if round1_locked() then
    raise exception 'Round 1 picks are locked (tournament has started).'
      using errcode = '40004';
  end if;
  return new;
end;
$$;

create or replace function enforce_round2_lock()
returns trigger
language plpgsql
as $$
begin
  if round2_locked() then
    raise exception 'Round 2 bracket picks are locked (knockouts have started).'
      using errcode = '40004';
  end if;
  return new;
end;
$$;

drop trigger if exists match_predictions_lock on match_predictions;
create trigger match_predictions_lock
  before insert or update on match_predictions
  for each row execute function enforce_round1_lock();

drop trigger if exists tournament_predictions_lock on tournament_predictions;
create trigger tournament_predictions_lock
  before insert or update on tournament_predictions
  for each row execute function enforce_round1_lock();

drop trigger if exists player_prop_predictions_lock on player_prop_predictions;
create trigger player_prop_predictions_lock
  before insert or update on player_prop_predictions
  for each row execute function enforce_round1_lock();

drop trigger if exists bracket_predictions_lock on bracket_predictions;
create trigger bracket_predictions_lock
  before insert or update on bracket_predictions
  for each row execute function enforce_round2_lock();

-- ---------------------------------------------------------------------------
-- Profile bootstrap trigger — create a profile row on signup
-- ---------------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
  candidate text;
  attempt int := 0;
begin
  base_username := lower(split_part(coalesce(new.email, 'user'), '@', 1));
  base_username := regexp_replace(base_username, '[^a-z0-9_]', '', 'g');
  if length(base_username) < 3 then
    base_username := 'player_' || substr(new.id::text, 1, 6);
  end if;
  candidate := base_username;
  while exists (select 1 from profiles where username = candidate) loop
    attempt := attempt + 1;
    candidate := base_username || attempt::text;
  end loop;
  insert into profiles (id, username, display_name)
  values (new.id, candidate, coalesce(new.raw_user_meta_data->>'display_name', candidate));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;
alter table leagues enable row level security;
alter table league_members enable row level security;
alter table league_invites enable row level security;
alter table tournament enable row level security;
alter table teams enable row level security;
alter table players enable row level security;
alter table matches enable row level security;
alter table match_predictions enable row level security;
alter table bracket_predictions enable row level security;
alter table tournament_predictions enable row level security;
alter table player_prop_predictions enable row level security;
alter table point_awards enable row level security;
alter table external_sync_log enable row level security;

-- profiles: anyone authenticated can read; user can update own.
drop policy if exists "profiles_read_all" on profiles;
create policy "profiles_read_all" on profiles
  for select to authenticated using (true);

drop policy if exists "profiles_update_self" on profiles;
create policy "profiles_update_self" on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- leagues: visible to members; owner can update.
drop policy if exists "leagues_read_members" on leagues;
create policy "leagues_read_members" on leagues
  for select to authenticated using (
    exists (select 1 from league_members lm where lm.league_id = leagues.id and lm.user_id = auth.uid())
  );

drop policy if exists "leagues_insert_self" on leagues;
create policy "leagues_insert_self" on leagues
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "leagues_update_owner" on leagues;
create policy "leagues_update_owner" on leagues
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- league_members: members can see fellow members; owner manages.
drop policy if exists "league_members_read_self_leagues" on league_members;
create policy "league_members_read_self_leagues" on league_members
  for select to authenticated using (
    exists (
      select 1 from league_members me
      where me.league_id = league_members.league_id and me.user_id = auth.uid()
    )
  );

drop policy if exists "league_members_owner_writes" on league_members;
create policy "league_members_owner_writes" on league_members
  for all to authenticated
  using (
    exists (select 1 from leagues l where l.id = league_members.league_id and l.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from leagues l where l.id = league_members.league_id and l.owner_id = auth.uid())
  );

-- league_invites: owner can manage; anyone can validate by token via RPC (service role).
drop policy if exists "league_invites_owner" on league_invites;
create policy "league_invites_owner" on league_invites
  for all to authenticated
  using (
    exists (select 1 from leagues l where l.id = league_invites.league_id and l.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from leagues l where l.id = league_invites.league_id and l.owner_id = auth.uid())
  );

-- tournament: read by anyone authenticated.
drop policy if exists "tournament_read" on tournament;
create policy "tournament_read" on tournament
  for select to authenticated using (true);

-- teams / players / matches: read by anyone authenticated. Writes via service role only.
drop policy if exists "teams_read" on teams;
create policy "teams_read" on teams for select to authenticated using (true);

drop policy if exists "players_read" on players;
create policy "players_read" on players for select to authenticated using (true);

drop policy if exists "matches_read" on matches;
create policy "matches_read" on matches for select to authenticated using (true);

-- match_predictions: self read/write always; other users' picks only after kickoff.
drop policy if exists "mp_read_self" on match_predictions;
create policy "mp_read_self" on match_predictions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "mp_read_after_kickoff" on match_predictions;
create policy "mp_read_after_kickoff" on match_predictions
  for select to authenticated using (
    exists (
      select 1 from matches m
      where m.id = match_predictions.match_id and m.kickoff_at <= now()
    )
    and exists (
      select 1 from league_members lm_self
      join league_members lm_other on lm_other.league_id = lm_self.league_id
      where lm_self.user_id = auth.uid() and lm_other.user_id = match_predictions.user_id
    )
  );

drop policy if exists "mp_write_self" on match_predictions;
create policy "mp_write_self" on match_predictions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- bracket_predictions: self always; others only after the slot's match kicks off.
drop policy if exists "bp_read_self" on bracket_predictions;
create policy "bp_read_self" on bracket_predictions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "bp_read_after_kickoff" on bracket_predictions;
create policy "bp_read_after_kickoff" on bracket_predictions
  for select to authenticated using (
    exists (
      select 1 from matches m
      where m.bracket_slot = bracket_predictions.bracket_slot and m.kickoff_at <= now()
    )
    and exists (
      select 1 from league_members lm_self
      join league_members lm_other on lm_other.league_id = lm_self.league_id
      where lm_self.user_id = auth.uid() and lm_other.user_id = bracket_predictions.user_id
    )
  );

drop policy if exists "bp_write_self" on bracket_predictions;
create policy "bp_write_self" on bracket_predictions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- tournament_predictions: self always; others after round1 locks (first kickoff).
drop policy if exists "tp_read_self" on tournament_predictions;
create policy "tp_read_self" on tournament_predictions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "tp_read_after_lock" on tournament_predictions;
create policy "tp_read_after_lock" on tournament_predictions
  for select to authenticated using (
    round1_locked() and exists (
      select 1 from league_members lm_self
      join league_members lm_other on lm_other.league_id = lm_self.league_id
      where lm_self.user_id = auth.uid() and lm_other.user_id = tournament_predictions.user_id
    )
  );

drop policy if exists "tp_write_self" on tournament_predictions;
create policy "tp_write_self" on tournament_predictions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- player_prop_predictions: same shape as tournament_predictions.
drop policy if exists "pp_read_self" on player_prop_predictions;
create policy "pp_read_self" on player_prop_predictions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "pp_read_after_lock" on player_prop_predictions;
create policy "pp_read_after_lock" on player_prop_predictions
  for select to authenticated using (
    round1_locked() and exists (
      select 1 from league_members lm_self
      join league_members lm_other on lm_other.league_id = lm_self.league_id
      where lm_self.user_id = auth.uid() and lm_other.user_id = player_prop_predictions.user_id
    )
  );

drop policy if exists "pp_write_self" on player_prop_predictions;
create policy "pp_write_self" on player_prop_predictions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- point_awards: anyone in a shared league can see; writes via service role only.
drop policy if exists "pa_read_shared_league" on point_awards;
create policy "pa_read_shared_league" on point_awards
  for select to authenticated using (
    user_id = auth.uid() or exists (
      select 1 from league_members lm_self
      join league_members lm_other on lm_other.league_id = lm_self.league_id
      where lm_self.user_id = auth.uid() and lm_other.user_id = point_awards.user_id
    )
  );

-- external_sync_log: admins only.
drop policy if exists "esl_admin_read" on external_sync_log;
create policy "esl_admin_read" on external_sync_log
  for select to authenticated using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );
