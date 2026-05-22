"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
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

export type CreateLeagueState = { error: string } | null;

export async function createLeague(_prev: CreateLeagueState, formData: FormData): Promise<CreateLeagueState> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in." };

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) return { error: "Name is required" };

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
  if (error || !created) return { error: error?.message ?? "Could not create" };

  const { error: memberError } = await service.from("league_members").insert({
    league_id: created.id,
    user_id: user.id,
    role: "owner",
  });
  if (memberError) {
    // Roll back so the slug isn't permanently taken on a half-failed create.
    await service.from("leagues").delete().eq("id", created.id);
    return { error: memberError.message };
  }

  // Sanity check: confirm the creator can see their own league via RLS. If
  // not, the destination page would 404 — surface that here instead so the
  // user gets a real error in the form rather than a confusing 404.
  const { data: visible, error: visibleError } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", created.id)
    .maybeSingle();
  if (!visible) {
    // Pull richer context so we can finally diagnose this on prod:
    // - the auth.uid() PostgREST sees for the caller's JWT
    // - whether the user can read their profile (proves role=authenticated)
    // - whether the user can read their own league_members row (proves the
    //   league_members RLS policy resolves correctly for them)
    const [uidRes, profileRes, memberRes] = await Promise.all([
      supabase.rpc("debug_auth_uid"),
      supabase.from("profiles").select("id").eq("id", user.id).maybeSingle(),
      supabase
        .from("league_members")
        .select("user_id, league_id")
        .eq("league_id", created.id)
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    Sentry.captureMessage("createLeague: new league not visible to creator via RLS", {
      level: "error",
      tags: { server_action: "createLeague" },
      extra: {
        user_id: user.id,
        league_id: created.id,
        slug: created.slug,
        visible_error: visibleError?.message ?? null,
        rls_auth_uid: uidRes.data ?? null,
        rls_auth_uid_error: uidRes.error?.message ?? null,
        profile_readable: !!profileRes.data,
        profile_error: profileRes.error?.message ?? null,
        member_row_readable: !!memberRes.data,
        member_error: memberRes.error?.message ?? null,
      },
    });
    await service.from("league_members").delete().eq("league_id", created.id);
    await service.from("leagues").delete().eq("id", created.id);
    return {
      error:
        "League created but not visible to you — likely a profile/RLS mismatch. Please contact an admin.",
    };
  }

  revalidatePath("/leagues");
  redirect(`/leagues/${created.slug}`);
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
