import { supabaseServer } from "@/lib/supabase/server";
import { fetchGroupMatchOptions } from "@/lib/predictions/group-matches";
import { ManualPropsForm } from "./ManualPropsForm";

type ServerClient = Awaited<ReturnType<typeof supabaseServer>>;

// The players catalogue is ~1,100+ rows (48 squads), past PostgREST's default
// page size, so range-paginate (mirrors the /predict/outcomes helper). Admin-only
// page; a long <select> is acceptable here.
async function fetchAllPlayers(client: ServerClient) {
  const pageSize = 1000;
  const all: { id: string; name: string; team: { name: string } | null }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = await client
      .from("players")
      .select("id, name, team:team_id(name)")
      .order("name")
      .order("id")
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as typeof all));
    if (data.length < pageSize) break;
  }
  return all;
}

export default async function AdminPropsPage() {
  const supabase = await supabaseServer();
  const [teamsRes, players, groupMatches, resolutionsRes] = await Promise.all([
    supabase.from("teams").select("id, name, code").order("name"),
    fetchAllPlayers(supabase),
    fetchGroupMatchOptions(supabase),
    supabase.from("manual_prop_resolutions").select("*"),
  ]);

  const teams = (teamsRes.data ?? []).map((t) => ({ id: t.id, name: t.name, code: t.code }));
  const playerOptions = players.map((p) => ({
    id: p.id,
    name: p.team?.name ? `${p.name} · ${p.team.name}` : p.name,
  }));

  const byKey = Object.fromEntries((resolutionsRes.data ?? []).map((r) => [r.prop_key, r]));
  const bool = (key: string) => {
    const v = byKey[key]?.answer_bool;
    return v == null ? "" : v ? "yes" : "no";
  };
  const current = {
    neymar_minutes: bool("neymar_minutes"),
    streaker: bool("streaker"),
    best_goalkeeper_player_id: byKey["best_goalkeeper"]?.answer_player_id ?? "",
    golden_boot_team_id: byKey["golden_boot_team"]?.answer_team_id ?? "",
    own_goals: byKey["own_goals"]?.answer_int != null ? String(byKey["own_goals"].answer_int) : "",
    war_game_match_id: byKey["war_game"]?.answer_match_id ?? "",
    swedish_players:
      byKey["swedish_players"]?.answer_int != null ? String(byKey["swedish_players"].answer_int) : "",
  };

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <h1 className="text-2xl font-bold">House special results</h1>
      <p className="text-sm text-[var(--muted)]">
        The off-the-books props the data feed can&apos;t settle automatically. Enter the actual
        result for each once it&apos;s decided; saving re-scores every prop (5 pts each — the two
        numeric ones split ties). Leave a field blank to mark it unresolved (no points awarded yet).
      </p>
      <ManualPropsForm
        teams={teams}
        players={playerOptions}
        groupMatches={groupMatches}
        current={current}
      />
    </div>
  );
}
