import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

// Canonical Supabase-SSR email-link handler (the token_hash flow).
//
// Unlike /auth/callback — which handles only the PKCE `?code=` grant and so
// needs the code-verifier cookie that signInWithOtp set on the *same* browser —
// this route verifies the hashed one-time token server-side. That means the
// email link completes sign-in even when it's opened in a different browser or
// an email app's in-app webview (the most common reason the link "did nothing"
// and dumped the user back on /login to enter their email a second time).
//
// REQUIRED Supabase dashboard companion (Auth → Email Templates) — repoint the
// link in both the "Confirm signup" and "Magic Link" templates at this route:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next={{ .RedirectTo }}
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next={{ .RedirectTo }}
// {{ .RedirectTo }} is the emailRedirectTo we set in signInWithEmail
// (/auth/callback[?invite=...]), so after verifying we hand back to that route's
// existing invite/leagues/onboarding routing.

// Allow only same-origin redirect targets (open-redirect guard). Accepts both a
// relative path and an absolute same-origin URL (emailRedirectTo is absolute).
function safeNext(origin: string, next: string | null): string {
  if (!next) return "/leagues";
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return "/leagues";
    return url.pathname + url.search;
  } catch {
    return "/leagues";
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");

  if (tokenHash && type) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(new URL(safeNext(origin, next), origin));
    }
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Invalid or expired confirmation link")}`,
  );
}
