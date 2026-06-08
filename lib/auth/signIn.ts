"use server";

import { supabaseServer } from "@/lib/supabase/server";

export type SignInResult =
  | { ok: true; mode: "code_sent" }
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
  // The same email carries both a magic link ({{ .ConfirmationURL }}) and a
  // numeric code ({{ .Token }}). Clicking the link routes through
  // /auth/callback; typing the code is verified by verifyEmailOtp() below.
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo: redirectTo.toString(),
      shouldCreateUser: !!inviteToken,
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, mode: "code_sent" };
}

export type VerifyOtpResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

export async function verifyEmailOtp(
  email: string,
  token: string,
  inviteToken?: string,
): Promise<VerifyOtpResult> {
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedToken = token.trim();
  if (!trimmedEmail) return { ok: false, error: "Email is required" };
  if (!trimmedToken) return { ok: false, error: "Enter the code from your email" };

  const supabase = await supabaseServer();
  // Verifying the code here (rather than via the email link) keeps sign-in on a
  // single device: the code is entered in the same browser/session that asked
  // for it, so there's no PKCE code-verifier or URL-hash to lose. On success
  // supabaseServer()'s cookie adapter persists the session — this runs in a
  // Server Action, so the cookie writes succeed (unlike in an RSC).
  //
  // A brand-new user's *first* email is Supabase's "Confirm signup" template,
  // whose code verifies as type:"signup"; a returning user gets the "Magic Link"
  // template (type:"email"). We try "email" first, then fall back to "signup",
  // so a new user's single emailed code is accepted on the first attempt instead
  // of being bounced back to re-enter their email (the OTP value is identical —
  // only the `type` GoTrue expects differs).
  const primary = await supabase.auth.verifyOtp({
    email: trimmedEmail,
    token: trimmedToken,
    type: "email",
  });
  if (primary.error) {
    const fallback = await supabase.auth.verifyOtp({
      email: trimmedEmail,
      token: trimmedToken,
      type: "signup",
    });
    // Surface the primary (magic-link) error — it's the canonical path and its
    // message ("Token has expired or is invalid") is the one users expect.
    if (fallback.error) return { ok: false, error: primary.error.message };
  }

  // Bounce invites through /join/[token] so the single redemption code path
  // (shared with the magic-link callback) handles success + visible failure.
  const redirectTo = inviteToken ? `/join/${inviteToken}` : "/leagues";
  return { ok: true, redirectTo };
}
