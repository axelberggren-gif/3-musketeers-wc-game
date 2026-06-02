"use server";

import { supabaseServer } from "@/lib/supabase/server";

export type SignInResult =
  | { ok: true; mode: "magic_link_sent" }
  | { ok: false; error: string };

export async function signInWithEmail(
  email: string,
  inviteToken?: string,
): Promise<SignInResult> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { ok: false, error: "Email is required" };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectTo = new URL("/auth/callback", appUrl);
  if (inviteToken) redirectTo.searchParams.set("invite", inviteToken);

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo: redirectTo.toString(),
      shouldCreateUser: !!inviteToken,
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, mode: "magic_link_sent" };
}
