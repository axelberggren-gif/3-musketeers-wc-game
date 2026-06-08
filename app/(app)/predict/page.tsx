import Link from "next/link";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { computeLockState } from "@/lib/scoring/lock";
import { GroupStageList, type GroupStageMatch } from "@/components/predict/GroupStageList";
import { CountdownBanner } from "@/components/predict/CountdownBanner";
import type { Pick1X2 } from "@/lib/supabase/types";

export default async function Round1Page() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const service = supabaseService();
  const [tournamentRes, matchesRes, picksRes, lastSyncRes] = await Promise.all([
    supabase.from("tournament").select("*").single(),
    supabase
      .from("matches")
      .select(
        "id, kickoff_at, group_letter, stage, home:teams!home_team_id(id, name, short_name, code, crest_url), away:teams!away_team_id(id, name, short_name, code, crest_url)",
      )
      .eq("stage", "GROUP")
      .order("kickoff_at", { ascending: true }),
    supabase.from("match_predictions").select("match_id, pick").eq("user_id", user.id),
    service
      .from("external_sync_log")
      .select("ran_at, endpoint, status_code, message")
      .eq("source", "football-data.org")
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const tournament = tournamentRes.data;
  const locks = computeLockState(tournament);
  const matches = (matchesRes.data ?? []) as unknown as GroupStageMatch[];
  const picksByMatch = Object.fromEntries(
    (picksRes.data ?? []).map((r) => [r.match_id as string, r.pick as Pick1X2]),
  ) as Record<string, Pick1X2>;
  const lastSync = lastSyncRes.data as
    | { ran_at: string; endpoint: string; status_code: number | null; message: string | null }
    | null;

  // Tally pick coverage per group letter so we can flag complete groups with ✓.
  // The date grouping that used to live here moved into <GroupStageList /> so it
  // can re-group the filtered subset client-side when a group filter is active.
  const groupCoverage: Record<string, { picked: number; total: number }> = {};
  for (const m of matches) {
    if (!m.group_letter) continue;
    const stats = groupCoverage[m.group_letter] ?? { picked: 0, total: 0 };
    stats.total += 1;
    if (picksByMatch[m.id] != null) stats.picked += 1;
    groupCoverage[m.group_letter] = stats;
  }
  const groupLetters = Object.keys(groupCoverage).sort();
  const totalPicked = Object.keys(picksByMatch).length;
  const totalToGo = matches.length - totalPicked;

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <span
          className="badge badge-coral self-start -rotate-2"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          Round 1 · Group stage
        </span>
        <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
          Stick your <span className="text-coral">picks</span>
        </h1>
        <p className="text-sm text-ink-soft">
          Tap a flag to commit. Picks autosave and can be changed any time before first kickoff.
        </p>
        <p className="text-sm text-ink-soft">
          Chasing the winner, golden boot &amp; props?{" "}
          <Link href="/predict/outcomes" className="font-display uppercase text-coral underline">
            They&rsquo;re on the Outcomes tab →
          </Link>
        </p>
      </header>

      {tournament && (
        <CountdownBanner target={tournament.first_kickoff_at} label="Round 1 locks in" />
      )}

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-display uppercase tracking-wide text-lg">Group stage — 1X2</h2>
          <span className="font-mono-sticker text-xs text-ink-soft">
            <b className="text-pitch">{totalPicked}</b> picked ·{" "}
            <b className="text-coral">{totalToGo}</b> to go
          </span>
        </div>
        {matches.length === 0 ? (
          <div className="card flex flex-col gap-1 text-sm text-ink-soft">
            <p>
              Group-stage fixtures haven&rsquo;t been seeded yet. An admin needs to run the
              football-data sync.
            </p>
            {lastSync ? (
              <p className="font-mono-sticker text-xs">
                Last sync attempt {new Date(lastSync.ran_at).toLocaleString()} ·{" "}
                {lastSync.endpoint}
                {lastSync.status_code ? ` · HTTP ${lastSync.status_code}` : ""} ·{" "}
                {lastSync.message ?? "(no message)"}
              </p>
            ) : (
              <p className="font-mono-sticker text-xs">
                No sync has run yet — check FOOTBALL_DATA_TOKEN, CRON_SECRET, and the
                app.cron_app_url / app.cron_secret Postgres GUCs.
              </p>
            )}
          </div>
        ) : (
          <GroupStageList
            matches={matches}
            groupLetters={groupLetters}
            groupCoverage={groupCoverage}
            picksByMatch={picksByMatch}
            locked={locks.round1Locked}
          />
        )}
      </section>
    </main>
  );
}
