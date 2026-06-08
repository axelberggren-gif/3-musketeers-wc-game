import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { SignOutButton } from "./SignOutButton";

export async function Nav() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name, is_admin")
    .eq("id", user.id)
    .single();

  return (
    <nav className="sticky top-0 z-20 border-b-2 border-ink bg-paper/95 backdrop-blur">
      <div className="max-w-6xl mx-auto px-3 sm:px-5 py-3 flex items-center gap-2 sm:gap-3">
        <Link
          href="/leagues"
          className="inline-flex items-center gap-1.5 bg-ink text-gold px-3 py-1.5 rounded-lg border-2 border-ink font-display text-base sm:text-lg tracking-wider"
          style={{ boxShadow: "3px 3px 0 var(--coral)" }}
        >
          <span>⚽ KICKOFF</span>
          <span className="text-pitch-light text-[0.65em]">&apos;26</span>
        </Link>
        <div className="flex gap-1 sm:gap-1.5 overflow-x-auto -mx-1 px-1">
          <NavLink href="/predict">Group stage</NavLink>
          <NavLink href="/predict/outcomes">Outcomes</NavLink>
          <NavLink href="/predict/bracket">Bracket</NavLink>
          <NavLink href="/leagues">Leagues</NavLink>
          {profile?.is_admin && <NavLink href="/admin">Admin</NavLink>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={profile ? `/profile/${profile.username}` : "/"}
            className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-full border-2 border-ink bg-white text-ink font-display text-xs uppercase tracking-wider"
            style={{ boxShadow: "3px 3px 0 var(--ink)" }}
          >
            <span
              className="w-5 h-5 rounded-full bg-gold border-2 border-ink inline-flex items-center justify-center text-[10px]"
              aria-hidden
            >
              {(profile?.display_name ?? profile?.username ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate max-w-[7rem]">
              {profile?.display_name ?? profile?.username ?? "Profile"}
            </span>
          </Link>
          <SignOutButton />
        </div>
      </div>
    </nav>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="font-display text-[11px] sm:text-xs uppercase tracking-wider px-3 py-1.5 rounded-full border-2 border-transparent text-ink hover:bg-gold hover:border-ink hover:[box-shadow:3px_3px_0_var(--ink)] whitespace-nowrap"
    >
      {children}
    </Link>
  );
}
