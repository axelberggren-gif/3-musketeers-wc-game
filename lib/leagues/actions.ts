"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { randomToken, unwrapRelation } from "@/lib/utils";

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export async function createLeague(formData: FormData) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) return { ok: false, error: "Name is required" } as const;

  const service = supabaseService();
  let slug = slugify(name);
  if (!slug) slug = randomToken(8);
  for (let i = 0; i < 8; i++) {
    const { data: existing } = await service.from("leagues").select("id").eq("slug", slug).maybeSingle();
    if (!existing) break;
    slug = `${slugify(name)}-${randomToken(4)}`;
  }

  const { data: created, error } = await service
    .from("leagues")
    .insert({ name, slug, description: description || null, owner_id: user.id })
    .select("id, slug")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Could not create" } as const;

  const { error: memberError } = await service.from("league_members").insert({
    league_id: created.id,
    user_id: user.id,
    role: "owner",
  });
  if (memberError) {
    // Roll back the league row so the user can retry — otherwise the slug
    // is taken and RLS hides the orphan from them, resulting in a 404.
    await service.from("leagues").delete().eq("id", created.id);
    return { ok: false, error: memberError.message } as const;
  }

  revalidatePath("/leagues");
  return { ok: true, slug: created.slug } as const;
}

export async function createInvite(leagueId: string) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const service = supabaseService();
  const { data: league } = await service
    .from("leagues")
    .select("owner_id, slug")
    .eq("id", leagueId)
    .single();
  if (!league || league.owner_id !== user.id) {
    return { ok: false, error: "Only the league owner can create invites." } as const;
  }

  const token = randomToken(16);
  const { error } = await service.from("league_invites").insert({
    league_id: leagueId,
    token,
    created_by: user.id,
    max_uses: 25,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  });
  if (error) return { ok: false, error: error.message } as const;

  revalidatePath(`/leagues/${league.slug}/members`);
  return { ok: true, token } as const;
}

export async function revokeInvite(inviteId: string, leagueSlug: string) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const service = supabaseService();
  const { data: invite } = await service
    .from("league_invites")
    .select("league_id, leagues(owner_id)")
    .eq("id", inviteId)
    .single();
  const ownerRel = unwrapRelation(
    invite?.leagues as { owner_id: string } | { owner_id: string }[] | null,
  );
  if (!invite || ownerRel?.owner_id !== user.id) {
    return { ok: false, error: "Forbidden" } as const;
  }
  const { error } = await service.from("league_invites").update({ revoked: true }).eq("id", inviteId);
  if (error) return { ok: false, error: error.message } as const;
  revalidatePath(`/leagues/${leagueSlug}/members`);
  return { ok: true } as const;
}
