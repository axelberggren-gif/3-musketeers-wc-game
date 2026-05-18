// Thin wrapper around the football-data.org REST API.
// Docs: https://www.football-data.org/documentation/api

const BASE = "https://api.football-data.org/v4";

export interface FdMatch {
  id: number;
  utcDate: string;
  status: "SCHEDULED" | "TIMED" | "IN_PLAY" | "PAUSED" | "FINISHED" | "POSTPONED" | "SUSPENDED" | "CANCELLED";
  stage:
    | "GROUP_STAGE"
    | "LAST_16"
    | "QUARTER_FINALS"
    | "SEMI_FINALS"
    | "THIRD_PLACE"
    | "FINAL";
  group: string | null;
  homeTeam: { id: number | null; name: string | null; shortName: string | null; tla: string | null; crest: string | null };
  awayTeam: { id: number | null; name: string | null; shortName: string | null; tla: string | null; crest: string | null };
  score: {
    winner: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null;
    fullTime: { home: number | null; away: number | null };
  };
  goals?: FdGoal[];
}

export interface FdGoal {
  minute: number | null;
  scorer: { id: number; name: string };
  team: { id: number; name: string };
}

export interface FdTeam {
  id: number;
  name: string;
  shortName: string | null;
  tla: string | null;
  crest: string | null;
  squad?: { id: number; name: string; position: string | null }[];
}

export interface FdScorer {
  player: { id: number; name: string };
  team: { id: number; name: string };
  goals: number;
}

export class FootballDataClient {
  constructor(
    private token: string = process.env.FOOTBALL_DATA_TOKEN ?? "",
    private competition: string = "WC",
  ) {}

  private async req<T>(path: string): Promise<T> {
    if (!this.token) throw new Error("FOOTBALL_DATA_TOKEN not configured");
    const res = await fetch(`${BASE}${path}`, {
      headers: { "X-Auth-Token": this.token },
      // Avoid Next caching while developing; we rely on cron cadence instead.
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`football-data ${res.status} ${path}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async teams(): Promise<{ teams: FdTeam[] }> {
    return this.req(`/competitions/${this.competition}/teams`);
  }

  async matches(opts?: { status?: string; dateFrom?: string; dateTo?: string }) {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.dateFrom) params.set("dateFrom", opts.dateFrom);
    if (opts?.dateTo) params.set("dateTo", opts.dateTo);
    const qs = params.toString();
    return this.req<{ matches: FdMatch[] }>(
      `/competitions/${this.competition}/matches${qs ? `?${qs}` : ""}`,
    );
  }

  async match(externalId: number) {
    return this.req<FdMatch>(`/matches/${externalId}`);
  }

  async scorers(limit = 30) {
    return this.req<{ scorers: FdScorer[] }>(`/competitions/${this.competition}/scorers?limit=${limit}`);
  }
}

// Map football-data stage → our stage enum
export function mapStage(stage: FdMatch["stage"]) {
  switch (stage) {
    case "GROUP_STAGE":
      return "GROUP" as const;
    case "LAST_16":
      return "R16" as const;
    case "QUARTER_FINALS":
      return "QF" as const;
    case "SEMI_FINALS":
      return "SF" as const;
    case "THIRD_PLACE":
      return "3RD" as const;
    case "FINAL":
      return "F" as const;
  }
}

export function mapWinner(winner: FdMatch["score"]["winner"]) {
  if (!winner) return null;
  if (winner === "HOME_TEAM") return "HOME" as const;
  if (winner === "AWAY_TEAM") return "AWAY" as const;
  return "DRAW" as const;
}

export function mapStatus(status: FdMatch["status"]) {
  if (status === "IN_PLAY" || status === "PAUSED") return "LIVE" as const;
  if (status === "FINISHED") return "FINISHED" as const;
  if (status === "POSTPONED" || status === "SUSPENDED" || status === "CANCELLED") return "POSTPONED" as const;
  return "SCHEDULED" as const;
}
