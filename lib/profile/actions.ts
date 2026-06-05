"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { sanitizeNext, validateUsername } from "./validation";

export type OnboardingState = { error: string } | null;

// Completes the /welcome onboarding step: validates the chosen username, writes
// it to the caller's own profile (RLS: profiles_update_self), marks them
// onboarded, then redirects to `next`. On failure returns { error } for the
// useActionState form to surface inline.
export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in." };

  const result = validateUsername(String(formData.get("username") ?? ""));
  if (!result.ok) return { error: result.error };
  const username = result.value;
  const next = sanitizeNext(String(formData.get("next") ?? ""));

  // Friendly pre-check (citext compares case-insensitively). The update below
  // also catches the race via Postgres 23505.
  const { data: clash } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .neq("id", user.id)
    .maybeSingle();
  if (clash) return { error: "That username is taken — pick another." };

  // display_name is nulled so every `display_name ?? username` render site
  // shows the chosen handle, never the stale auto-generated display name.
  const { error } = await supabase
    .from("profiles")
    .update({ username, display_name: null, onboarded: true })
    .eq("id", user.id);
  if (error) {
    if (error.code === "23505") {
      return { error: "That username is taken — pick another." };
    }
    return { error: error.message };
  }

  // league_standings (materialized) caches username/display_name, so refresh it
  // to propagate the chosen handle to every league board the user is in.
  // Service client; CONCURRENTLY is valid via league_standings_pk. Best-effort.
  try {
    await supabaseService().rpc("refresh_league_standings");
  } catch (e) {
    Sentry.captureException(e, { tags: { area: "onboarding" } });
  }

  revalidatePath("/leagues");
  redirect(next);
}
