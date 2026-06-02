import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const inviteToken = searchParams.get("invite");

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

  if (inviteToken) {
    // Bounce through /join/[token] so the single redemption code path
    // handles success (redirect to league) and failure (visible error).
    return NextResponse.redirect(`${origin}/join/${inviteToken}`);
  }

  return NextResponse.redirect(`${origin}/leagues`);
}
