import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { consumeInviteForUser, readPendingInvite, clearPendingInvite } from "@/lib/auth/invite";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const inviteFromUrl = searchParams.get("invite");

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
    }
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.redirect(`${origin}/login`);

  const inviteToken = inviteFromUrl ?? (await readPendingInvite());
  if (inviteToken) {
    const result = await consumeInviteForUser(inviteToken, user.id);
    await clearPendingInvite();
    if (result.ok) {
      return NextResponse.redirect(`${origin}/leagues/${result.league_slug}`);
    }
  }

  return NextResponse.redirect(`${origin}/leagues`);
}
