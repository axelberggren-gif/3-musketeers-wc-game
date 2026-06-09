import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { InviteControls } from "./InviteControls";
import { RemoveMemberButton } from "./RemoveMemberButton";

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
      .select("user_id, role, joined_at, profile:user_id(username, display_name)")
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
    user_id: m.user_id as string,
    role: m.role as "owner" | "member",
    joined_at: m.joined_at as string,
    profile: (Array.isArray(m.profile) ? m.profile[0] : m.profile) as {
      username: string;
      display_name: string | null;
    },
  }));

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href={`/leagues/${slug}`}
          className="font-mono-sticker text-xs uppercase tracking-widest text-ink-soft hover:text-ink"
        >
          ← {league.name}
        </Link>
        <span
          className="badge badge-gold self-start -rotate-2"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          The crew
        </span>
        <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
          Members
        </h1>
      </header>

      <section className="card flex flex-col gap-3">
        <h2 className="font-display uppercase tracking-wide text-base">
          {members.length} player{members.length === 1 ? "" : "s"}
        </h2>
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li
              key={m.profile.username}
              className="flex items-center justify-between gap-2 rounded-lg border-2 border-ink bg-paper-2 px-3 py-2"
              style={{ boxShadow: "2px 2px 0 var(--ink)" }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-8 h-8 rounded-full bg-paper border-2 border-ink inline-flex items-center justify-center font-display text-sm">
                  {(m.profile.display_name ?? m.profile.username).slice(0, 1).toUpperCase()}
                </span>
                <Link
                  href={`/profile/${m.profile.username}`}
                  className="font-display uppercase text-sm tracking-wide hover:text-coral truncate"
                >
                  {m.profile.display_name ?? m.profile.username}
                </Link>
              </div>
              {m.role === "owner" ? (
                <span className="badge badge-pitch !text-[10px]">Owner</span>
              ) : isOwner ? (
                <RemoveMemberButton
                  leagueId={league.id}
                  leagueSlug={slug}
                  userId={m.user_id}
                  memberName={m.profile.display_name ?? m.profile.username}
                />
              ) : null}
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
