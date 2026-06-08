import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { sanitizeNext } from "@/lib/profile/validation";
import { WelcomeForm } from "./WelcomeForm";

// Onboarding username picker. Lives in (auth) — which has no layout — so the
// app/(app)/layout.tsx onboarding gate does NOT apply here (no redirect loop).
// Does its own auth check, mirroring (auth)/login/page.tsx.
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = sanitizeNext(next);

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarded, username")
    .eq("id", user.id)
    .maybeSingle();

  // Already named themselves — don't let them re-enter onboarding.
  if (profile?.onboarded) redirect(safeNext);

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-12 sm:py-20">
      <div className="w-full max-w-md flex flex-col gap-5">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 self-center bg-ink text-gold px-3 py-1.5 rounded-lg border-2 border-ink font-display text-base tracking-wider"
          style={{ boxShadow: "3px 3px 0 var(--coral)" }}
        >
          ⚽ KICKOFF<span className="text-pitch-light text-[0.65em]">&apos;26</span>
        </Link>
        <div className="card flex flex-col gap-5">
          <span
            className="badge badge-gold self-start -rotate-2"
            style={{ boxShadow: "3px 3px 0 var(--ink)" }}
          >
            👋 One last thing
          </span>
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display uppercase text-3xl sm:text-4xl leading-none tracking-tight">
              Pick your name
            </h1>
            <p className="text-sm text-ink-soft">
              This is how you&rsquo;ll show up on every leaderboard and in every league
              you join. Lowercase letters, numbers and underscores.
            </p>
          </div>
          <WelcomeForm next={safeNext} defaultUsername={profile?.username ?? ""} />
        </div>
      </div>
    </main>
  );
}
