import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { InviteControls } from "./InviteControls";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, slug, owner_id")
    .eq("slug", slug)
    .maybeSingle();
  if (!league) notFound();

  const isOwner = league.owner_id === user.id;

  const [membersRes, invitesRes] = await Promise.all([
    supabase
      .from("league_members")
      .select("role, joined_at, profile:user_id(username, display_name)")
      .eq("league_id", league.id),
    isOwner
      ? supabase
          .from("league_invites")
          .select("*")
          .eq("league_id", league.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
  ]);

  const members = (membersRes.data ?? []).map((m) => ({
    role: m.role as "owner" | "member",
    joined_at: m.joined_at as string,
    profile: (Array.isArray(m.profile) ? m.profile[0] : m.profile) as {
      username: string;
      display_name: string | null;
    },
  }));

  return (
    <main className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href={`/leagues/${slug}`} className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
          ← {league.name}
        </Link>
        <h1 className="text-3xl font-bold">Members</h1>
      </header>

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">{members.length} players</h2>
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {members.map((m) => (
            <li key={m.profile.username} className="flex items-center justify-between py-2 text-sm">
              <Link href={`/profile/${m.profile.username}`} className="hover:text-[var(--accent)]">
                {m.profile.display_name ?? m.profile.username}
              </Link>
              {m.role === "owner" && <span className="badge">Owner</span>}
            </li>
          ))}
        </ul>
      </section>

      {isOwner && (
        <InviteControls leagueId={league.id} leagueSlug={slug} invites={invitesRes.data ?? []} />
      )}
    </main>
  );
}
