import type { supabaseServer } from "@/lib/supabase/server";
import type { MatchOption } from "@/components/predict/MatchSelect";

type ServerClient = Awaited<ReturnType<typeof supabaseServer>>;

// Group-stage matches as dropdown options for the "war game" prop (which group
// game collects the most cards). Labels are built here, server-side, so the
// client selectors stay dumb: e.g. "SWE vs DEN · Group A". Pre-fixture-import
// this returns [] and the picker shows an empty state. Shared by the user-facing
// /predict/outcomes board and the admin /admin/props resolver.
export async function fetchGroupMatchOptions(client: ServerClient): Promise<MatchOption[]> {
  const { data } = await client
    .from("matches")
    .select(
      "id, group_letter, home:teams!home_team_id(name, code), away:teams!away_team_id(name, code)",
    )
    .eq("stage", "GROUP")
    .order("kickoff_at");
  return (data ?? []).map((m) => {
    const h = m.home?.code ?? m.home?.name ?? "TBD";
    const a = m.away?.code ?? m.away?.name ?? "TBD";
    const g = m.group_letter ? ` · Group ${m.group_letter}` : "";
    return { id: m.id, label: `${h} vs ${a}${g}` };
  });
}
