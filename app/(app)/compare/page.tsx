import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { computeLockState } from "@/lib/scoring/lock";
import {
  groupMatchesByLetter,
  loadGroupStagePicks,
  pickOutcome,
  tallyPickRecord,
  type PickRecord,
} from "@/lib/stats/group-picks";
import { PickChip } from "@/components/picks/PickChip";
import { MatchScoreline } from "@/components/picks/MatchScoreline";
import {
  ComparePlayerSelect,
  type CompareOption,
} from "@/components/picks/ComparePlayerSelect";
import { POINTS } from "@/lib/scoring/rules";

type ProfileLite = { id: string; username: string; display_name: string | null };
type MemberRow = {
  user_id: string;
  profile: { username: string; display_name: string | null } | null;
};

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a, b } = await searchParams;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: viewerProfile } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .eq("id", user.id)
    .maybeSingle();
  if (!viewerProfile) notFound();

  // The viewer occupies any slot the URL leaves empty.
  const aUsername = a ?? viewerProfile.username;
  const bUsername = b ?? viewerProfile.username;

  const [aRes, bRes, tournamentRes, myLeaguesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, username, display_name")
      .eq("username", aUsername)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, username, display_name")
      .eq("username", bUsername)
      .maybeSingle(),
    supabase.from("tournament").select("*").single(),
    supabase.from("league_members").select("league_id").eq("user_id", user.id),
  ]);
  const aProfile = aRes.data as ProfileLite | null;
  const bProfile = bRes.data as ProfileLite | null;
  if (!aProfile || !bProfile) notFound();

  const locks = computeLockState(tournamentRes.data);

  // Swap options: everyone sharing a league with the viewer (their picks are
  // the ones RLS can reveal), the viewer included.
  const leagueIds = [...new Set((myLeaguesRes.data ?? []).map((r) => r.league_id))];
  let memberRows: MemberRow[] = [];
  if (leagueIds.length > 0) {
    const { data } = await supabase
      .from("league_members")
      .select("user_id, profile:user_id(username, display_name)")
      .in("league_id", leagueIds);
    memberRows = (data ?? []) as MemberRow[];
  }
  const optionByUsername = new Map<string, CompareOption>();
  optionByUsername.set(viewerProfile.username, {
    username: viewerProfile.username,
    label: `${viewerProfile.display_name ?? viewerProfile.username} (you)`,
  });
  for (const row of memberRows) {
    if (!row.profile || row.user_id === user.id) continue;
    optionByUsername.set(row.profile.username, {
      username: row.profile.username,
      label: row.profile.display_name ?? row.profile.username,
    });
  }
  const options = [...optionByUsername.values()].sort((x, y) =>
    x.label.localeCompare(y.label),
  );

  const { matches, picksByUser } = await loadGroupStagePicks([aProfile.id, bProfile.id]);
  const aPicks = picksByUser[aProfile.id] ?? {};
  const bPicks = picksByUser[bProfile.id] ?? {};
  const aRecord = tallyPickRecord(matches, aPicks);
  const bRecord = tallyPickRecord(matches, bPicks);
  const groups = groupMatchesByLetter(matches);

  const sameCall = matches.filter((m) => {
    const pa = aPicks[m.id];
    const pb = bPicks[m.id];
    return !!pa && !!pb && pa.pick === pb.pick;
  }).length;

  const aLabel = aProfile.display_name ?? aProfile.username;
  const bLabel = bProfile.display_name ?? bProfile.username;
  const someoneHidden = aRecord.made === 0 || bRecord.made === 0;

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span
          className="badge badge-gold self-start -rotate-2"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          ⚔️ Head to head
        </span>
        <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
          Compare picks
        </h1>
        <p className="text-sm text-ink-soft">
          Group-stage 1X2 calls side by side. Swap either player for anyone in your
          leagues.
        </p>
      </header>

      <section className="card grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ComparePlayerSelect
          slot="a"
          value={aProfile.username}
          other={bProfile.username}
          options={options}
          label={`Player A — ${aLabel}`}
        />
        <ComparePlayerSelect
          slot="b"
          value={bProfile.username}
          other={aProfile.username}
          options={options}
          label={`Player B — ${bLabel}`}
        />
      </section>

      {!locks.round1Locked ? (
        <section className="card">
          <p className="text-sm text-ink-soft">
            🤫 Picks stay secret until the first kickoff. Come back once round 1 locks
            to compare everyone&apos;s calls.
          </p>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-3 gap-3">
            <RecordTile name={aLabel} record={aRecord} accent="gold" />
            <div
              className="rounded-xl border-2 border-ink bg-paper-2 p-3 sm:p-4 flex flex-col gap-1 items-center text-center"
              style={{ boxShadow: "3px 3px 0 var(--ink)" }}
            >
              <p className="font-mono-sticker text-[10px] uppercase tracking-widest font-medium opacity-80">
                Same call
              </p>
              <p className="font-display text-2xl sm:text-3xl tabular-nums leading-none">
                {sameCall}
              </p>
              <p className="font-mono-sticker text-[10px] text-ink-soft">matches</p>
            </div>
            <RecordTile name={bLabel} record={bRecord} accent="coral" />
          </section>

          {someoneHidden && (
            <p className="text-sm text-ink-soft">
              Seeing only dashes for someone? You can only view picks of people who
              share a league with you — or they simply haven&apos;t picked.
            </p>
          )}

          {matches.length === 0 ? (
            <section className="card">
              <p className="text-sm text-ink-soft">
                No group-stage fixtures yet — the board fills in once the schedule is
                imported.
              </p>
            </section>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {groups.map(({ letter, matches: groupMatches }) => (
                <section key={letter} className="card flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display uppercase text-sm tracking-wide">
                      Group {letter}
                    </h2>
                    <span className="font-mono-sticker text-[9px] uppercase tracking-widest text-ink-soft">
                      {aLabel} · {bLabel}
                    </span>
                  </div>
                  <ul className="flex flex-col divide-y divide-dashed divide-ink-soft/40">
                    {groupMatches.map((m) => {
                      const pa = aPicks[m.id] ?? null;
                      const pb = bPicks[m.id] ?? null;
                      return (
                        <li
                          key={m.id}
                          className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2 first:pt-0 last:pb-0"
                        >
                          <span className="justify-self-start">
                            <PickChip
                              pick={pa?.pick ?? null}
                              homeCode={m.home?.code}
                              awayCode={m.away?.code}
                              outcome={pa ? pickOutcome(pa.pick, m) : "pending"}
                            />
                          </span>
                          <MatchScoreline match={m} />
                          <span className="justify-self-end">
                            <PickChip
                              pick={pb?.pick ?? null}
                              homeCode={m.home?.code}
                              awayCode={m.away?.code}
                              outcome={pb ? pickOutcome(pb.pick, m) : "pending"}
                            />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <p className="text-sm">
        <Link
          href={`/profile/${bProfile.username}`}
          className="font-mono-sticker text-xs uppercase tracking-widest text-ink-soft hover:text-ink"
        >
          ← Back to {bLabel}&apos;s profile
        </Link>
      </p>
    </main>
  );
}

function RecordTile({
  name,
  record,
  accent,
}: {
  name: string;
  record: PickRecord;
  accent: "gold" | "coral";
}) {
  const bg = accent === "gold" ? "bg-gold" : "bg-coral text-white";
  return (
    <div
      className={`rounded-xl border-2 border-ink p-3 sm:p-4 flex flex-col gap-1 items-center text-center ${bg}`}
      style={{ boxShadow: "3px 3px 0 var(--ink)" }}
    >
      <p className="font-mono-sticker text-[10px] uppercase tracking-widest font-medium opacity-80 truncate max-w-full">
        {name}
      </p>
      <p className="font-display text-2xl sm:text-3xl tabular-nums leading-none">
        {record.correct}/{record.decided}
      </p>
      <p className="font-mono-sticker text-[10px] tabular-nums opacity-80">
        +{record.correct * POINTS.match1x2} pts from results so far
      </p>
    </div>
  );
}
