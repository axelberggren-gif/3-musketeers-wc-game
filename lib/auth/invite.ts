import { supabaseService } from "@/lib/supabase/server";
import { unwrapRelation } from "@/lib/utils";

export interface ValidatedInvite {
  invite_id: string;
  league_id: string;
  league_name: string;
  league_slug: string;
}

export async function validateInviteToken(token: string): Promise<ValidatedInvite | null> {
  if (!token) return null;
  const service = supabaseService();
  const { data } = await service
    .from("league_invites")
    .select("id, league_id, expires_at, max_uses, uses_count, revoked, leagues(name, slug)")
    .eq("token", token)
    .maybeSingle();
  if (!data || data.revoked) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  if (data.max_uses && data.uses_count >= data.max_uses) return null;
  const league = unwrapRelation(
    data.leagues as { name: string; slug: string } | { name: string; slug: string }[] | null,
  );
  if (!league) return null;
  return {
    invite_id: data.id,
    league_id: data.league_id,
    league_name: league.name,
    league_slug: league.slug,
  };
}

interface RedeemRow {
  ok: boolean;
  league_slug: string | null;
  error: string | null;
}

export async function consumeInviteForUser(token: string, userId: string) {
  const service = supabaseService();
  const { data, error } = await service.rpc("redeem_league_invite", {
    p_token: token,
    p_user_id: userId,
  });
  if (error) return { ok: false, error: error.message } as const;
  const row = (Array.isArray(data) ? data[0] : (data as RedeemRow | null)) as RedeemRow | undefined;
  if (!row?.ok || !row.league_slug) {
    return { ok: false, error: row?.error ?? "Invite is invalid or expired." } as const;
  }
  return { ok: true, league_slug: row.league_slug } as const;
}
