-- ---------------------------------------------------------------------------
-- 0015_profile_onboarding.sql
-- Onboarding flag so new users pick their own username before entering the app.
--
-- handle_new_user() (0001) auto-generates a username from the email local-part
-- with no UI to change it, so invited friends silently get a handle they never
-- chose. The /welcome screen now collects a username; this flag drives the gate
-- in app/(app)/layout.tsx that routes un-onboarded users there.
--
-- NOTE: default false applies to EXISTING rows too, so every current account is
-- prompted once on next login (pre-filled with their current handle — one tap to
-- keep). That is intentional: it's what retro-fixes already-joined members.
--
-- handle_new_user() is deliberately NOT changed: its INSERT doesn't list this
-- column, so new rows inherit the `false` default automatically.
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists onboarded boolean not null default false;
