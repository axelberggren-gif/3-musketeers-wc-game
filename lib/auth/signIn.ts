"use server";

import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { consumeInviteForUser } from "@/lib/auth/invite";

export type SignInResult =
  | { ok: true; mode: "instant"; url: string }
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

  const devInstant = process.env.DEV_INSTANT_LOGIN === "true";

  if (devInstant) {
    const service = supabaseService();
    const { data: list, error: listErr } = await service.auth.admin.listUsers({
      perPage: 200,
    });
    if (listErr) return { ok: false, error: listErr.message };
    const user = list.users.find((u) => u.email?.toLowerCase() === trimmed);
    if (!user) {
      return {
        ok: false,
        error: "No user with that email. Create one in Supabase → Authentication → Users first.",
      };
    }

    // Generate a one-time link to grab the hashed_token, then verify it
    // server-side so the @supabase/ssr cookies are set directly. This avoids
    // the PKCE-flow round-trip through the browser, which fails when no
    // code_verifier was stored client-side.
    const { data: linkData, error: linkErr } = await service.auth.admin.generateLink({
      type: "magiclink",
      email: trimmed,
    });
    const hashedToken = linkData?.properties?.hashed_token;
    if (linkErr || !hashedToken) {
      return { ok: false, error: linkErr?.message ?? "Could not generate sign-in token" };
    }

    const ssrClient = await supabaseServer();
    const { error: verifyErr } = await ssrClient.auth.verifyOtp({
      type: "magiclink",
      token_hash: hashedToken,
    });
    if (verifyErr) return { ok: false, error: verifyErr.message };

    if (inviteToken) {
      const consumed = await consumeInviteForUser(inviteToken, user.id);
      if (!consumed.ok) {
        return {
          ok: false,
          error: `Signed in, but couldn't join the league: ${consumed.error}`,
        };
      }
      return { ok: true, mode: "instant", url: `/leagues/${consumed.league_slug}` };
    }
    return { ok: true, mode: "instant", url: "/leagues" };
  }

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
