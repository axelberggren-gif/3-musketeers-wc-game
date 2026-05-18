import { cookies } from "next/headers";
import { supabaseService } from "@/lib/supabase/server";

const COOKIE_NAME = "invite_token";

export async function setPendingInvite(token: string) {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
}

export async function readPendingInvite() {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}

export async function clearPendingInvite() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

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
  const league = Array.isArray(data.leagues) ? data.leagues[0] : data.leagues;
  if (!league) return null;
  return {
    invite_id: data.id,
    league_id: data.league_id,
    league_name: league.name,
    league_slug: league.slug,
  };
}

export async function consumeInviteForUser(token: string, userId: string) {
  const service = supabaseService();
  const validated = await validateInviteToken(token);
  if (!validated) return { ok: false, error: "Invite is invalid or expired." } as const;

  // Insert membership (no-op if already a member)
  const { error: memberErr } = await service
    .from("league_members")
    .upsert(
      { league_id: validated.league_id, user_id: userId, role: "member" },
      { onConflict: "league_id,user_id" },
    );
  if (memberErr) return { ok: false, error: memberErr.message } as const;

  // Increment use count
  const { data: cur } = await service
    .from("league_invites")
    .select("uses_count")
    .eq("id", validated.invite_id)
    .single();
  if (cur) {
    await service
      .from("league_invites")
      .update({ uses_count: (cur.uses_count ?? 0) + 1 })
      .eq("id", validated.invite_id);
  }

  return { ok: true, league_slug: validated.league_slug } as const;
}
