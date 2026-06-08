import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) redirect("/leagues");

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="badge text-[var(--accent)]">Admin</span>
        <nav className="flex gap-1">
          <AdminLink href="/admin">Overview</AdminLink>
          <AdminLink href="/admin/sync">Sync</AdminLink>
          <AdminLink href="/admin/matches">Matches</AdminLink>
          <AdminLink href="/admin/props">Props</AdminLink>
          <AdminLink href="/admin/users">Users</AdminLink>
          <AdminLink href="/admin/tournament">Tournament</AdminLink>
        </nav>
      </div>
      {children}
    </div>
  );
}

function AdminLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-2 py-1 rounded text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)]"
    >
      {children}
    </Link>
  );
}
