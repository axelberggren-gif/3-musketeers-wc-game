import { supabaseServer } from "@/lib/supabase/server";

export interface ProfileStats {
  totalPoints: number;
  matchPoints: number;
  bracketPoints: number;
  tournamentPoints: number;
  propPoints: number;
  // picksMade / accuracy are only computed when the viewer IS the profile owner
  // — RLS scopes `match_predictions` differently from `point_awards`, so mixing
  // the two for other viewers produces a misleading percentage.
  picksMade: number | null;
  picksScored: number;
  accuracy: number | null;
  pointsByDay: { date: string; points: number }[];
}

export async function loadProfileStats(
  userId: string,
  viewerId?: string,
): Promise<ProfileStats> {
  const isSelf = !!viewerId && viewerId === userId;
  const supabase = await supabaseServer();

  const awardsRes = await supabase
    .from("point_awards")
    .select("prediction_type, points, awarded_at")
    .eq("user_id", userId)
    .order("awarded_at");

  const picksRes = isSelf
    ? await supabase.from("match_predictions").select("id").eq("user_id", userId)
    : null;

  const safeAwards = awardsRes.data ?? [];
  const matchAwards = safeAwards.filter((a) => a.prediction_type === "match");
  const totalPoints = safeAwards.reduce((sum, a) => sum + (a.points ?? 0), 0);
  const matchPoints = matchAwards.reduce((sum, a) => sum + (a.points ?? 0), 0);
  const bracketPoints = safeAwards
    .filter((a) => a.prediction_type === "bracket")
    .reduce((sum, a) => sum + (a.points ?? 0), 0);
  const tournamentPoints = safeAwards
    .filter((a) => a.prediction_type === "tournament")
    .reduce((sum, a) => sum + (a.points ?? 0), 0);
  const propPoints = safeAwards
    .filter((a) => a.prediction_type === "prop")
    .reduce((sum, a) => sum + (a.points ?? 0), 0);

  const picksScored = matchAwards.length;
  const picksMade = picksRes ? (picksRes.data ?? []).length : null;
  const accuracy =
    picksMade !== null && picksMade > 0
      ? Math.round((picksScored / picksMade) * 100)
      : null;

  const byDay = new Map<string, number>();
  for (const a of safeAwards) {
    const date = new Date(a.awarded_at).toISOString().slice(0, 10);
    byDay.set(date, (byDay.get(date) ?? 0) + (a.points ?? 0));
  }
  const pointsByDay = Array.from(byDay.entries()).map(([date, points]) => ({ date, points }));

  return {
    totalPoints,
    matchPoints,
    bracketPoints,
    tournamentPoints,
    propPoints,
    picksMade,
    picksScored,
    accuracy,
    pointsByDay,
  };
}
