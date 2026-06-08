// Thin wrapper around the football-data.org REST API.
// Docs: https://www.football-data.org/documentation/api

const BASE = "https://api.football-data.org/v4";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number) {
  // 500ms, 1000ms (between attempts 1→2, 2→3).
  return 500 * 2 ** (attempt - 1);
}

// Node's undici throws a bare `TypeError: fetch failed` for transient
// network errors (DNS, TCP reset, TLS handshake, socket hang up) with the
// underlying reason hung off `.cause`. AbortSignal.timeout() produces a
// DOMException name "TimeoutError". Both are safe to retry; everything else
// (4xx-equivalent thrown above, programmer errors) is not.
function isTransientFetchError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: string; message?: string };
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  if (err.name === "TypeError" && err.message === "fetch failed") return true;
  return false;
}

export interface FdMatch {
  id: number;
  utcDate: string;
  status: "SCHEDULED" | "TIMED" | "IN_PLAY" | "PAUSED" | "FINISHED" | "POSTPONED" | "SUSPENDED" | "CANCELLED";
  stage:
    | "GROUP_STAGE"
    | "LAST_32"
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
  bookings?: FdBooking[];
}

export interface FdGoal {
  minute: number | null;
  scorer: { id: number; name: string };
  team: { id: number; name: string };
}

export interface FdBooking {
  minute: number | null;
  team:   { id: number; name: string };
  player: { id: number; name: string };
  card:   "YELLOW" | "RED" | "YELLOW_RED";
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
    // Retry transient network failures (DNS/TCP/TLS blips that surface as
    // Node undici's `TypeError: fetch failed`) and 5xx upstream errors with
    // a short exponential backoff. Per-request timeout via AbortSignal so a
    // hung socket can't stall the cron handler past the platform's limit.
    // Total worst-case wall time: ~10s + 0.5s + 10s + 1s + 10s ≈ 31.5s.
    const MAX_ATTEMPTS = 3;
    const TIMEOUT_MS = 10_000;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(`${BASE}${path}`, {
          headers: { "X-Auth-Token": this.token },
          // Avoid Next caching while developing; we rely on cron cadence instead.
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          // Retry 5xx (upstream transient); fail-fast on 4xx (our bug).
          if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
            lastErr = new Error(`football-data ${res.status} ${path}: ${text.slice(0, 200)}`);
            await sleep(backoffMs(attempt));
            continue;
          }
          throw new Error(`football-data ${res.status} ${path}: ${text.slice(0, 200)}`);
        }
        return (await res.json()) as T;
      } catch (e) {
        lastErr = e;
        // Only retry network-level / timeout failures. Anything thrown above
        // with a `football-data <status>` message is from the non-ok branch
        // (already a final 4xx, since we `continue`'d on 5xx) — don't loop.
        if (!isTransientFetchError(e) || attempt >= MAX_ATTEMPTS) throw e;
        await sleep(backoffMs(attempt));
      }
    }
    // Unreachable — the loop either returns or throws. Satisfy TS.
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
// WC 2026 introduces a Round of 32 as the first knockout round; football-data
// v4 exposes it as `LAST_32`. If they end up using a different label for the
// actual tournament data, the migration 0013 enum value `R32` stays correct —
// only this mapping needs adjusting.
export function mapStage(stage: FdMatch["stage"]) {
  switch (stage) {
    case "GROUP_STAGE":
      return "GROUP" as const;
    case "LAST_32":
      return "R32" as const;
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

export type LocalStage = ReturnType<typeof mapStage>;

// Slot labels mirror components/predict/BracketBuilder.tsx and the score_bracket
// SQL function: R32-1..16, R16-1..8, QF-A..D, SF-A..B, F. Index is the match's
// order within its stage by kickoff time — the deterministic schedule means
// R32-1 is always the first R32 match.
export function deriveBracketSlot(stage: LocalStage, indexInStage: number): string | null {
  switch (stage) {
    case "R32":
      return `R32-${indexInStage + 1}`;
    case "R16":
      return `R16-${indexInStage + 1}`;
    case "QF":
      return `QF-${String.fromCharCode(65 + indexInStage)}`;
    case "SF":
      return `SF-${String.fromCharCode(65 + indexInStage)}`;
    case "F":
      return "F";
    case "3RD":
      return "3RD";
    default:
      return null;
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
