// Player position bucketing for the Outcomes player picker.
//
// football-data.org returns a free-text `position` per squad member. National-team
// squads usually carry the coarse labels ("Goalkeeper" / "Defence" / "Midfield" /
// "Offence"), but granular ones ("Centre-Back", "Defensive Midfield", "Left Winger",
// "Centre-Forward", …) also show up. We collapse both into the four filterable
// buckets the picker exposes. Pure + no IO so it's unit-testable and usable from
// both server (mapping) and client (filtering) code.

export type PositionGroup = "GK" | "DEF" | "MID" | "ATT";

/**
 * Map a raw football-data position string into one of four buckets.
 *
 * Match order is deliberate so ambiguous compounds resolve correctly:
 *  1. goalkeepers first;
 *  2. "midfield" before "defen"/"back" so "Defensive Midfield" → MID (not DEF);
 *  3. "back"/"defen" before the forward rules so "Wing-Back" → DEF (not ATT).
 *
 * Returns `null` for unknown/empty positions — those players still appear under the
 * "All" filter and via search, they just don't match a position pill.
 */
export function normalizePosition(raw: string | null | undefined): PositionGroup | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes("keeper") || s.includes("goalie") || s === "gk") return "GK";
  if (s.includes("midfield")) return "MID";
  if (s.includes("back") || s.includes("defen")) return "DEF";
  if (
    s.includes("forward") ||
    s.includes("wing") ||
    s.includes("strik") ||
    s.includes("offen") || // Offence / Offense
    s.includes("attack")
  ) {
    return "ATT";
  }
  return null;
}

/** The position filter pills, in display order. Goalkeepers last. */
export const POSITION_FILTERS: { key: PositionGroup; label: string }[] = [
  { key: "DEF", label: "Defenders" },
  { key: "MID", label: "Midfielders" },
  { key: "ATT", label: "Attackers" },
  { key: "GK", label: "Keepers" },
];
