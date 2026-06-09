import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { isoToLocal } from "@/lib/utils";

export default async function AdminLeaguesPage() {
  // The admin layout already gates /admin/*, but we re-verify here because the
  // queries below use the service-role client (RLS bypass). `leagues` and
  // `league_members` are member-scoped under RLS, so the RLS-aware client would
  // only surface leagues this admin happens to belong to — defeating the point
  // of an overview. The explicit is_admin check satisfies the service-role
  // authorization invariant (see lib/supabase/CLAUDE.md).
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!me?.is_admin) redirect("/leagues");

  const service = supabaseService();
  const [leaguesRes, membersRes, profilesRes] = await Promise.all([
    service
      .from("leagues")
      .select("id, slug, name, description, owner_id, created_at")
      .order("created_at", { ascending: true }),
    service.from("league_members").select("league_id, user_id, role, joined_at"),
    service.from("profiles").select("id, username, display_name"),
  ]);

  const leagues = leaguesRes.data ?? [];
  const members = membersRes.data ?? [];
  const profiles = profilesRes.data ?? [];

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const nameFor = (userId: string) => {
    const p = profileById.get(userId);
    return p?.display_name ?? p?.username ?? userId;
  };

  // Group members by league; within a league put the owner first, then sort
  // the rest alphabetically by display name.
  type MemberRow = (typeof members)[number];
  const membersByLeague = new Map<string, MemberRow[]>();
  for (const m of members) {
    const list = membersByLeague.get(m.league_id) ?? [];
    list.push(m);
    membersByLeague.set(m.league_id, list);
  }
  for (const list of membersByLeague.values()) {
    list.sort((a, b) => {
      if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
      return nameFor(a.user_id).localeCompare(nameFor(b.user_id));
    });
  }

  const distinctPlayers = new Set(members.map((m) => m.user_id)).size;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Leagues</h1>
        <p className="text-sm text-[var(--muted)]">
          Every league and who&rsquo;s in it. This view spans all leagues — it bypasses the
          per-league visibility that applies everywhere else.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card label="Leagues" value={leagues.length} />
        <Card label="Memberships" value={members.length} />
        <Card label="Distinct players" value={distinctPlayers} />
      </div>

      {leagues.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No leagues created yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {leagues.map((l) => {
            const roster = membersByLeague.get(l.id) ?? [];
            return (
              <section key={l.id} className="card flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-semibold">{l.name}</h2>
                      <span className="badge text-[var(--muted)]">
                        {roster.length} member{roster.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--muted)] font-mono">/leagues/{l.slug}</p>
                    {l.description && (
                      <p className="text-sm text-[var(--muted)] mt-1">{l.description}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 text-xs text-[var(--muted)] shrink-0">
                    <span>Created {isoToLocal(l.created_at, { weekday: undefined })}</span>
                    <Link href={`/leagues/${l.slug}`} className="text-[var(--accent)]">
                      View league →
                    </Link>
                  </div>
                </div>

                {roster.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">No members.</p>
                ) : (
                  <div className="overflow-x-auto -mx-4 px-4">
                    <table className="w-full text-sm">
                      <thead className="text-[var(--muted)] text-xs uppercase">
                        <tr>
                          <th className="text-left py-1.5">Player</th>
                          <th className="text-left py-1.5">Username</th>
                          <th className="text-left py-1.5">Role</th>
                          <th className="text-left py-1.5">Joined</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {roster.map((m) => {
                          const p = profileById.get(m.user_id);
                          return (
                            <tr key={m.user_id}>
                              <td className="py-1.5">{p?.display_name ?? p?.username ?? "—"}</td>
                              <td className="py-1.5 font-mono text-[var(--muted)]">
                                {p?.username ? `@${p.username}` : m.user_id}
                              </td>
                              <td className="py-1.5">
                                {m.role === "owner" ? (
                                  <span className="badge text-[var(--accent)]">Owner</span>
                                ) : (
                                  <span className="text-[var(--muted)]">Member</span>
                                )}
                              </td>
                              <td className="py-1.5 text-[var(--muted)] text-xs">
                                {isoToLocal(m.joined_at, { weekday: undefined })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <p className="text-xs text-[var(--muted)] uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
