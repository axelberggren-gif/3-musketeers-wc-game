import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/leagues");

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
            className="badge badge-coral self-start -rotate-2"
            style={{ boxShadow: "3px 3px 0 var(--ink)" }}
          >
            No passwords · Email code
          </span>
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display uppercase text-3xl sm:text-4xl leading-none tracking-tight">
              Sign in
            </h1>
            <p className="text-sm text-ink-soft">
              We&apos;ll email you a 6-digit code. Type it in and you&apos;re in.
            </p>
          </div>
          <LoginForm />
        </div>
        <div className="card !p-4 text-sm flex items-center justify-between gap-3">
          <span className="text-ink-soft">Got an invite link?</span>
          <span className="font-mono-sticker text-xs text-ink">paste it into your browser</span>
        </div>
      </div>
    </main>
  );
}
