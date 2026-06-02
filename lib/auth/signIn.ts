"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { consumeInviteForUser } from "@/lib/auth/invite";

export type SignInResult =
  | { ok: true; mode: "code_sent" }
  | { ok: false; error: string };

export type VerifyResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

/**
 * Step 1 of sign-in: email the user a 6-digit one-time code. We use a code
 * (not a clickable magic link) because corporate email link-scanners pre-fetch
 * links and burn the single-use token before the human clicks it, and because
 * the PKCE link flow depends on a code_verifier cookie that breaks cross-device.
 * The code is delivered via Supabase's "Magic Link" email template — set it to
 * render `{{ .Token }}`.
 */
export async function signInWithEmail(
  email: string,
  inviteToken?: string,
): Promise<SignInResult> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { ok: false, error: "Email is required" };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      // Only invited newcomers may create an account; bare /login sign-in is
      // restricted to existing users (friends-only league).
      shouldCreateUser: !!inviteToken,
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, mode: "code_sent" };
}

/**
 * Step 2 of sign-in: verify the 6-digit code. `verifyOtp` sets the @supabase/ssr
 * session cookies directly (no callback round-trip, no code_verifier), so this
 * works on any device the code is typed into. When an invite token rode along,
 * we redeem it here and route the user straight to the league.
 */
export async function verifyEmailCode(
  email: string,
  token: string,
  inviteToken?: string,
): Promise<VerifyResult> {
  const trimmed = email.trim().toLowerCase();
  const code = token.trim();
  if (!trimmed) return { ok: false, error: "Email is required" };
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: "Enter the 6-digit code from your email." };
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({
    email: trimmed,
    token: code,
    type: "email",
  });
  if (error) return { ok: false, error: error.message };
  const user = data.user;
  if (!user) return { ok: false, error: "Could not verify that code. Request a new one." };

  if (inviteToken) {
    const consumed = await consumeInviteForUser(inviteToken, user.id);
    if (!consumed.ok) {
      return { ok: false, error: `Signed in, but couldn't join the league: ${consumed.error}` };
    }
    return { ok: true, redirectTo: `/leagues/${consumed.league_slug}` };
  }
  return { ok: true, redirectTo: "/leagues" };
}
