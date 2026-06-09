-- 2026-06-09  Raise the league-invite usage cap from 25 to 100.
--
-- Invite links are shared widely in a friends league (WhatsApp, group chats),
-- and a single link is expected to admit ~60 people. The previous default of
-- 25 (stamped by lib/leagues/actions.ts:createInvite) was too low, so links hit
-- "Invite has reached its limit." well before everyone had joined.
--
-- lib/leagues/actions.ts now writes max_uses = 100 (the INVITE_MAX_USES const)
-- for NEW invites. This migration bumps any EXISTING invite still on the old 25
-- cap so already-shared links keep working without having to be recreated.
--
-- Non-destructive: raising a cap only ever admits MORE people, never fewer, and
-- the row-locked check in redeem_league_invite() (migration 0009) reads max_uses
-- live, so concurrent joins still cannot exceed the new cap.
--
-- Scoped to rows still at exactly 25 (the only value createInvite ever wrote),
-- so re-applying is a no-op and any future / manually-set caps are left alone.

update league_invites
   set max_uses = 100
 where max_uses = 25;
