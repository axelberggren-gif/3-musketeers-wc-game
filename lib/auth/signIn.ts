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
  // type: "email" is the OTP issued by signInWithOtp (passwordless email).
  // On success supabaseServer()'s cookie adapter persists the session — this
  // runs in a Server Action, so the cookie writes succeed (unlike in an RSC).
  const { error } = await supabase.auth.verifyOtp({
    email: trimmedEmail,
    token: trimmedToken,
    type: "email",
  });
  if (error) return { ok: false, error: error.message };

  // Bounce invites through /join/[token] so the single redemption code path
  // (shared with the magic-link callback) handles success + visible failure.
  const redirectTo = inviteToken ? `/join/${inviteToken}` : "/leagues";
  return { ok: true, redirectTo };
}
