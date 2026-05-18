import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { SignOutButton } from "./SignOutButton";
import { Trophy } from "lucide-react";

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
    <nav className="border-b border-[var(--border)] sticky top-0 z-10 backdrop-blur bg-[color:var(--background)]/80">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
        <Link href="/leagues" className="flex items-center gap-2 font-semibold">
          <Trophy className="w-5 h-5 text-[var(--accent)]" />
          <span>Kickoff</span>
        </Link>
        <div className="flex gap-1 text-sm">
          <NavLink href="/predict">Round 1</NavLink>
          <NavLink href="/predict/bracket">Bracket</NavLink>
          <NavLink href="/leagues">Leagues</NavLink>
          {profile?.is_admin && <NavLink href="/admin">Admin</NavLink>}
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Link
            href={profile ? `/profile/${profile.username}` : "/"}
            className="text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            {profile?.display_name ?? profile?.username ?? "Profile"}
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
      className="px-3 py-1.5 rounded-md text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)]"
    >
      {children}
    </Link>
  );
}
