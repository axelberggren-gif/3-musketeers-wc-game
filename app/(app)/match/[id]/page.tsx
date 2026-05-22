import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { CountryFlag } from "@/components/CountryFlag";
import { matchIsLocked } from "@/lib/scoring/lock";
import { isoToLocal, unwrapRelation } from "@/lib/utils";
import type { Pick1X2 } from "@/lib/supabase/types";

type MatchTeamRel = { id: string; name: string; code: string; crest_url: string | null };
type ProfileRel = { username: string; display_name: string | null };

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: match } = await supabase
    .from("matches")
    .select(
      "id, kickoff_at, stage, group_letter, status, home_score, away_score, winner, home:home_team_id(id, name, code, crest_url), away:away_team_id(id, name, code, crest_url)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!match) notFound();

  const home = unwrapRelation(match.home as MatchTeamRel | MatchTeamRel[] | null);
  const away = unwrapRelation(match.away as MatchTeamRel | MatchTeamRel[] | null);

  const locked = matchIsLocked(match.kickoff_at);

  const { data: myPick } = await supabase
    .from("match_predictions")
    .select("pick")
    .eq("match_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: friendsPicks } = locked
    ? await supabase
        .from("match_predictions")
        .select("pick, profile:user_id(username, display_name)")
        .eq("match_id", id)
    : { data: null };

  const tally =
    locked && friendsPicks
      ? friendsPicks.reduce<Record<Pick1X2, number>>(
          (acc, r) => {
            const pick = r.pick as Pick1X2;
            acc[pick] = (acc[pick] ?? 0) + 1;
            return acc;
          },
          { HOME: 0, DRAW: 0, AWAY: 0 },
        )
      : null;

  const finished = match.status === "FINISHED";
  const live = match.status === "IN_PLAY" || match.status === "PAUSED";

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <Link
        href="/leagues"
        className="font-mono-sticker text-xs uppercase tracking-widest text-ink-soft hover:text-ink"
      >
        ← Back
      </Link>
      <section
        className="card flex flex-col gap-5"
        style={{ boxShadow: live ? "4px 4px 0 var(--coral)" : "4px 4px 0 var(--ink)" }}
      >
        <header className="flex items-center justify-between gap-2 flex-wrap">
          <span className="badge">
            {match.group_letter ? `Group ${match.group_letter}` : match.stage}
          </span>
          <span className="font-mono-sticker text-[11px] uppercase tracking-widest text-ink-soft">
            {isoToLocal(match.kickoff_at)}
          </span>
          {live ? (
            <span className="badge badge-red">● LIVE</span>
          ) : finished ? (
            <span className="badge badge-pitch">Final</span>
          ) : (
            <span className="badge badge-gold">{match.status}</span>
          )}
        </header>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 sm:gap-6 items-center">
          <TeamSide team={home} />
          <div className="text-center">
            {finished ? (
              <div className="font-display text-5xl sm:text-7xl tabular-nums leading-none">
                {match.home_score}
                <span className="text-coral mx-1">–</span>
                {match.away_score}
              </div>
            ) : (
              <div className="font-mono-sticker text-2xl text-ink-soft uppercase tracking-widest">
                vs
              </div>
            )}
          </div>
          <TeamSide team={away} />
        </div>
        <div
          className="rounded-lg border-2 border-ink bg-paper-2 px-3 py-2 text-center"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          <span className="font-mono-sticker text-[10px] uppercase tracking-widest text-ink-soft font-medium">
            Your pick
          </span>
          <div className="font-display uppercase text-base mt-1">
            {myPick?.pick ? <PickLabel pick={myPick.pick as Pick1X2} home={home} away={away} /> : "— not picked —"}
          </div>
        </div>
      </section>

      {locked && tally && friendsPicks && (
        <section className="card flex flex-col gap-4">
          <h2 className="font-display uppercase tracking-wide text-base">League picks</h2>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <PickStat label={home?.code ?? "Home"} count={tally.HOME} total={friendsPicks.length} color="gold" />
            <PickStat label="Draw" count={tally.DRAW} total={friendsPicks.length} color="paper-2" />
            <PickStat label={away?.code ?? "Away"} count={tally.AWAY} total={friendsPicks.length} color="coral" />
          </div>
          <ul className="flex flex-col gap-2">
            {friendsPicks.map((row, i) => {
              const profile = unwrapRelation(row.profile as ProfileRel | ProfileRel[] | null);
              const pick = row.pick as Pick1X2;
              return (
                <li
                  key={`${profile?.username}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-lg border-2 border-ink bg-paper-2 px-3 py-2"
                  style={{ boxShadow: "2px 2px 0 var(--ink)" }}
                >
                  <Link
                    href={`/profile/${profile?.username}`}
                    className="font-display uppercase text-sm tracking-wide hover:text-coral"
                  >
                    {profile?.display_name ?? profile?.username}
                  </Link>
                  <span className="badge badge-ink !text-[10px]">{pick}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}

function TeamSide({ team }: { team: { name: string; code: string; crest_url: string | null } | null }) {
  return (
    <div className="flex flex-col items-center gap-2 min-w-0">
      <div
        className="w-14 h-14 sm:w-20 sm:h-20 rounded-xl bg-paper-2 border-2 border-ink flex items-center justify-center"
        style={{ boxShadow: "3px 3px 0 var(--ink)" }}
      >
        <CountryFlag
          crestUrl={team?.crest_url}
          code={team?.code}
          name={team?.name ?? "TBD"}
          size={48}
        />
      </div>
      <span className="font-display uppercase text-sm sm:text-base tracking-wide text-center truncate max-w-full">
        {team?.code ?? team?.name ?? "TBD"}
      </span>
    </div>
  );
}

function PickLabel({
  pick,
  home,
  away,
}: {
  pick: Pick1X2;
  home: { code: string; name: string } | null;
  away: { code: string; name: string } | null;
}) {
  if (pick === "HOME") return <>{home?.code ?? home?.name ?? "Home"}</>;
  if (pick === "AWAY") return <>{away?.code ?? away?.name ?? "Away"}</>;
  return <>Draw</>;
}

function PickStat({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: "gold" | "coral" | "paper-2";
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const bg = color === "gold" ? "bg-gold" : color === "coral" ? "bg-coral text-white" : "bg-paper-2";
  return (
    <div
      className={`rounded-lg border-2 border-ink ${bg} p-3 text-center`}
      style={{ boxShadow: "2px 2px 0 var(--ink)" }}
    >
      <p className="font-mono-sticker text-[10px] uppercase tracking-widest font-medium">{label}</p>
      <p className="font-display text-2xl tabular-nums leading-none mt-1">{count}</p>
      <p className="font-mono-sticker text-[10px] tabular-nums mt-1 opacity-80">{pct}%</p>
    </div>
  );
}
