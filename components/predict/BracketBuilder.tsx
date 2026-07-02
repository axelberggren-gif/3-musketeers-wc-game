"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { clearBracketPicks, setBracketPick } from "@/lib/predictions/actions";
import { CountryFlag } from "@/components/CountryFlag";
import {
  BRACKET_UPSTREAM,
  slotFriendlyName,
  upstreamSlots,
} from "@/lib/scoring/bracket-tree";
import { POINTS, bracketPointsForSlot } from "@/lib/scoring/rules";

export interface BracketTeam {
  id: string;
  name: string;
  short_name: string | null;
  code: string;
  crest_url: string | null;
}

export type BracketStage = "R32" | "R16" | "QF" | "SF" | "F" | "W";

export interface BracketSlot {
  slot: string;
  label: string;
  stage: BracketStage;
}

export interface BracketMatchPair {
  homeTeamId: string | null;
  awayTeamId: string | null;
}

/**
 * The real result of the knockout match backing a slot (once it's FINISHED).
 * For the `W` (champion) slot the page maps in the Final's result, since the
 * champion is scored off the Final match. `winnerTeamId` is the real winner;
 * `status` mirrors `matches.status`.
 */
export interface SlotResult {
  winnerTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
}

interface Props {
  slots: BracketSlot[];
  teams: BracketTeam[];
  initial: Record<string, string | null>;
  /** Round-2 lock. When true the bracket flips to the read-only, live-scored mode. */
  locked: boolean;
  /**
   * Future-betting window (migrations 0032/0036): the viewer's league was
   * reopened past the global knockout lock. Unplayed matches stay bettable
   * while every slot in `playedSlots` is settled read-only against the real
   * result. Ignored when `locked` is true.
   */
  futures?: boolean;
  /**
   * Slots whose real match has kicked off (or is LIVE/FINISHED) — the per-slot
   * lock inside the future-betting window. `W` locks with the Final. Computed
   * server-side by the page; the server actions + DB trigger are the real gate.
   */
  playedSlots?: Record<string, boolean>;
  /**
   * Real knockout match pairings keyed by `bracket_slot` (e.g. `R32-1`, `F`).
   * Feeds the R32 entry cells: each side is filled with its real team as soon as
   * football-data resolves it on the fixture (sides may resolve one at a time, so
   * a side can be null while the other is set). A side that football-data hasn't
   * filled yet shows a neutral "To be decided" placeholder. football-data is
   * authoritative — we never guess the team from group standings, because that
   * guess can disagree with the real draw (no head-to-head tiebreak, and the
   * qualification map's slot order differs from football-data's kickoff-ordered
   * slotting) and would place a team in the wrong slot. Downstream cells never use
   * this — their contestants are always the user's own upstream picks.
   */
  slotMatches: Record<string, BracketMatchPair>;
  /** Real results per slot, used to score the bracket in live mode. */
  results: Record<string, SlotResult>;
}

const STAGE_ORDER: BracketStage[] = ["R32", "R16", "QF", "SF", "F", "W"];

// Symmetric wall-chart halves: the left draw flows rightward into the Final,
// the right draw flows leftward. The slots are ordered top→bottom so each
// downstream cell lands centred between its two real feeders per
// `BRACKET_UPSTREAM` (the FIFA bracket pairs non-adjacent kickoff-ordered
// slots, so this is NOT a plain 1..16 / 1..8 sequence). Left half feeds SF-A
// (QF-A + QF-B); right half feeds SF-B (QF-C + QF-D).
const LEFT = {
  // R16-1[R32-2,5] · R16-2[R32-1,3] · R16-5[R32-11,12] · R16-6[R32-9,10]
  R32: ["R32-2", "R32-5", "R32-1", "R32-3", "R32-11", "R32-12", "R32-9", "R32-10"],
  R16: ["R16-1", "R16-2", "R16-5", "R16-6"], // QF-A[R16-1,2] · QF-B[R16-5,6]
  QF: ["QF-A", "QF-B"], // SF-A
  SF: ["SF-A"],
} as const;
const RIGHT = {
  SF: ["SF-B"],
  QF: ["QF-C", "QF-D"], // QF-C[R16-3,4] · QF-D[R16-7,8]
  R16: ["R16-3", "R16-4", "R16-7", "R16-8"],
  // R16-3[R32-4,6] · R16-4[R32-7,8] · R16-7[R32-14,16] · R16-8[R32-13,15]
  R32: ["R32-4", "R32-6", "R32-7", "R32-8", "R32-14", "R32-16", "R32-13", "R32-15"],
} as const;

const STAGE_PTS: Record<BracketStage, number> = {
  R32: POINTS.bracket.R32,
  R16: POINTS.bracket.R16,
  QF: POINTS.bracket.QF,
  SF: POINTS.bracket.SF,
  F: POINTS.bracket.F,
  W: POINTS.bracket.WINNER,
};
const STAGE_COUNT: Record<BracketStage, number> = { R32: 16, R16: 8, QF: 4, SF: 2, F: 1, W: 1 };
const MAX_POSSIBLE = STAGE_ORDER.reduce((sum, s) => sum + STAGE_PTS[s] * STAGE_COUNT[s], 0); // 85

const DOWNSTREAM_OF: Record<string, string[]> = buildDownstreamMap();

function buildDownstreamMap(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const [downstream, ups] of Object.entries(BRACKET_UPSTREAM)) {
    for (const up of ups) {
      (map[up] ??= []).push(downstream);
    }
  }
  return map;
}

function collectDownstream(slot: string): string[] {
  const out: string[] = [];
  const queue = [...(DOWNSTREAM_OF[slot] ?? [])];
  while (queue.length) {
    const next = queue.shift()!;
    out.push(next);
    queue.push(...(DOWNSTREAM_OF[next] ?? []));
  }
  return out;
}

function stageOf(slot: string): BracketStage {
  return slot === "W" ? "W" : (slot.split("-")[0] as BracketStage);
}

// ── Connector geometry (transform-independent, measured from real DOM) ──────
// Offset-chain box relative to `root` — unaffected by parent scroll/zoom.
function localBox(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

function elbow(ax: number, ay: number, bx: number, by: number) {
  const mx = (ax + bx) / 2;
  return `M ${ax} ${ay} H ${mx} V ${by} H ${bx}`;
}

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// ── Contestant + feeder-label resolution ────────────────────────────────────
// A slot's side is either a known team, a downstream feeder still waiting on the
// user's upstream pick ("Winner of Quarter-final 1"), or — for an R32 entry cell
// side football-data hasn't resolved yet — a neutral placeholder ("To be decided").
type Contestant =
  | { kind: "team"; teamId: string }
  | { kind: "feeder"; from: string }
  | { kind: "qualifier"; label: string };

type BracketMode = "build" | "futures" | "live";

interface ResolveCtx {
  picks: Record<string, string | null>;
  slotMatches: Record<string, BracketMatchPair>;
  results: Record<string, SlotResult>;
  teamById: Record<string, BracketTeam>;
  mode: BracketMode;
}

// The two (or one, for W) contestants of a slot. R32 cells resolve each side
// from the authoritative imported fixture as soon as football-data fills it
// (sides resolve independently — one can be a real team while the other is
// still pending); a side football-data hasn't filled shows a neutral
// "To be decided" placeholder. We deliberately do NOT label it with a group
// qualification source (Winner/Runner-up/3rd of Group X): the `R32_QUALIFIERS`
// map's slot numbering follows FIFA's "Matches 73–88" order while
// `deriveBracketSlot()` assigns `bracket_slot` by kickoff order, so the two
// don't line up and the source would routinely be wrong (the same misalignment
// that, when used to guess a team, duplicated one across slots). Every other
// slot derives its contestants from the user's own upstream picks.
function contestantsFor(slot: string, ctx: ResolveCtx): Contestant[] {
  const stage = stageOf(slot);
  if (stage === "R32") {
    const m = ctx.slotMatches[slot];
    const side = (teamId: string | null | undefined): Contestant =>
      teamId ? { kind: "team", teamId } : { kind: "qualifier", label: "To be decided" };
    return [side(m?.homeTeamId), side(m?.awayTeamId)];
  }
  if (slot === "W") {
    const f = ctx.picks["F"];
    return [f ? { kind: "team", teamId: f } : { kind: "feeder", from: "F" }];
  }
  // Future-betting window: reality outranks the user's picks — a downstream
  // side is the slot's real imported pairing when known, else the real winner
  // of a FINISHED feeder, and only then the user's own (still-live) feeder
  // pick. Guarantees every offered team has actually advanced.
  if (ctx.mode === "futures") {
    const m = ctx.slotMatches[slot];
    if (m?.homeTeamId && m?.awayTeamId) {
      return [
        { kind: "team", teamId: m.homeTeamId },
        { kind: "team", teamId: m.awayTeamId },
      ];
    }
    return upstreamSlots(slot).map((up): Contestant => {
      const r = ctx.results[up];
      if (r?.status === "FINISHED" && r.winnerTeamId) {
        return { kind: "team", teamId: r.winnerTeamId };
      }
      if (ctx.picks[up]) return { kind: "team", teamId: ctx.picks[up]! };
      return { kind: "feeder", from: up };
    });
  }
  return upstreamSlots(slot).map((up): Contestant =>
    ctx.picks[up] ? { kind: "team", teamId: ctx.picks[up]! } : { kind: "feeder", from: up },
  );
}

function teamCode(teamById: Record<string, BracketTeam>, id: string): string {
  const t = teamById[id];
  return t?.code ?? t?.short_name ?? t?.name?.slice(0, 3).toUpperCase() ?? "?";
}

// The placeholder text for a not-yet-known side: downstream cells name the
// feeding round ("Winner of Quarter-final 1"); an unresolved R32 side shows the
// neutral label carried on the qualifier contestant ("To be decided").
function pendingLabelFor(c: Extract<Contestant, { kind: "feeder" | "qualifier" }>): string {
  return c.kind === "feeder" ? `Winner of ${slotFriendlyName(c.from)}` : c.label;
}

// Banked points + per-stage hit rate for a locked bracket vs reality.
function bracketScore(
  picks: Record<string, string | null>,
  results: Record<string, SlotResult>,
  slotsByStage: Record<BracketStage, string[]>,
) {
  let banked = 0;
  const perStage: Record<string, { correct: number; total: number; revealed: boolean; perfect: boolean }> = {};
  for (const stage of STAGE_ORDER) {
    const slots = slotsByStage[stage] ?? [];
    let correct = 0;
    let finished = 0;
    for (const slot of slots) {
      const r = results[slot];
      if (r && r.status === "FINISHED") {
        finished += 1;
        if (picks[slot] && picks[slot] === r.winnerTeamId) {
          correct += 1;
          banked += bracketPointsForSlot(slot);
        }
      }
    }
    perStage[stage] = {
      correct,
      total: slots.length,
      revealed: finished > 0,
      perfect: finished === slots.length && correct === slots.length,
    };
  }
  return { banked, perStage, maxPossible: MAX_POSSIBLE };
}

// ─────────────────────────────────────────────────────────────────────────────
export function BracketBuilder({
  slots,
  teams,
  initial,
  locked,
  futures = false,
  playedSlots = {},
  slotMatches,
  results,
}: Props) {
  const [picks, setPicks] = useState<Record<string, string | null>>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const mode: BracketMode = locked ? "live" : futures ? "futures" : "build";

  const teamById = useMemo(
    () => Object.fromEntries(teams.map((t) => [t.id, t])) as Record<string, BracketTeam>,
    [teams],
  );
  const slotsByStage = useMemo(() => {
    const acc = {} as Record<BracketStage, string[]>;
    for (const s of slots) (acc[s.stage] ??= []).push(s.slot);
    return acc;
  }, [slots]);

  const ctx: ResolveCtx = useMemo(
    () => ({ picks, slotMatches, results, teamById, mode }),
    [picks, slotMatches, results, teamById, mode],
  );

  const applyPick = useCallback(
    (slot: string, teamId: string) => {
      if (locked || playedSlots[slot]) return;
      const previous = { ...picks };
      // What advances out of a feeder after this edit: the new pick for the
      // edited slot; in futures mode a FINISHED feeder's REAL winner (a
      // downstream pick can back it with no user pick on the feeder — don't
      // clear those); otherwise the user's pick.
      const effectiveWinner = (u: string): string | null | undefined => {
        if (u === slot) return teamId;
        if (futures) {
          const r = results[u];
          if (r?.status === "FINISHED" && r.winnerTeamId) return r.winnerTeamId;
        }
        return picks[u];
      };
      const invalidatedDownstream = collectDownstream(slot)
        // A played slot's bet is settled — never cascade a delete into it (its
        // match kicked off before anything upstream of an editable slot, so
        // this can't trigger; belt-and-braces with the DB per-slot lock).
        .filter((ds) => !playedSlots[ds])
        .filter((ds) => {
          const newWinners = new Set(upstreamSlots(ds).map(effectiveWinner).filter(Boolean));
          return picks[ds] && !newWinners.has(picks[ds]!);
        });

      const next = { ...picks, [slot]: teamId };
      for (const ds of invalidatedDownstream) next[ds] = null;
      setPicks(next);
      setError(null);

      startTransition(async () => {
        const result = await setBracketPick(slot, teamId);
        if (!result.ok) {
          setPicks(previous);
          setError(result.error);
          return;
        }
        if (invalidatedDownstream.length > 0) {
          const clearRes = await clearBracketPicks(invalidatedDownstream);
          if (!clearRes.ok) setError(clearRes.error);
        }
      });
    },
    [locked, playedSlots, picks, futures, results],
  );

  // ── Connector measurement ──────────────────────────────────────────────
  // Cells are tagged with `data-slot`; `measure` (run in an effect, never during
  // render) reads their boxes from the DOM, so no per-cell ref map is needed.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [geo, setGeo] = useState<{ down: string; up: string; d: string }[]>([]);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const boxes: Record<string, ReturnType<typeof localBox>> = {};
    root.querySelectorAll<HTMLElement>("[data-slot]").forEach((el) => {
      const slot = el.dataset.slot;
      if (slot) boxes[slot] = localBox(el, root);
    });
    const box = (slot: string) => boxes[slot] ?? null;
    const conns: { down: string; up: string; d: string }[] = [];
    for (const [down, ups] of Object.entries(BRACKET_UPSTREAM)) {
      if (down === "W") continue; // champion sits below the Final; no drawn connector
      const db = box(down);
      if (!db) continue;
      for (const up of ups) {
        const ub = box(up);
        if (!ub) continue;
        const fromLeft = ub.x + ub.w / 2 < db.x + db.w / 2;
        const ax = fromLeft ? ub.x + ub.w : ub.x;
        const ay = ub.y + ub.h / 2;
        const bx = fromLeft ? db.x : db.x + db.w;
        const by = db.y + db.h / 2;
        conns.push({ down, up, d: elbow(ax, ay, bx, by) });
      }
    }
    setGeo(conns);
  }, []);

  useIsomorphicLayoutEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(measure));
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && rootRef.current) {
      ro = new ResizeObserver(measure);
      ro.observe(rootRef.current);
    }
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(measure).catch(() => {});
    }
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
    // re-measure when picks change (cells grow/shrink as teams resolve) or on mode flip.
  }, [measure, picks, mode]);

  // Futures mode scores too — the played half of the bracket is already settling.
  const score = mode !== "build" ? bracketScore(picks, results, slotsByStage) : null;

  const renderColumn = (columnSlots: readonly string[]) => (
    <div className="flex flex-col justify-around h-full min-w-0" style={{ flex: "1 1 0" }}>
      {columnSlots.map((slot) => (
        <div key={slot} data-slot={slot}>
          <MatchCell
            slot={slot}
            ctx={ctx}
            mode={mode}
            played={!!playedSlots[slot]}
            locked={locked}
            pending={pending}
            result={results[slot]}
            onPick={applyPick}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="text-xs text-red font-medium border-2 border-red rounded-xl px-3 py-2 bg-paper-2">
          {error}
        </p>
      )}

      {/* top bar: build legend / live scoreboard (futures shows both — you're
          still betting AND points are already settling) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusPill mode={mode} results={results} slotsByStage={slotsByStage} />
        <div className="flex flex-wrap items-center gap-3">
          {mode !== "live" && <StageLegend />}
          {score && <PointsHUD score={score} />}
        </div>
      </div>

      {/* the wall chart — fills the container on desktop (lg+, no horizontal
          scroll); on phones/tablets it keeps a generous 72rem floor so every cell
          stays full-size and readable, and the whole poster side-scrolls. We'd far
          rather scroll a long way than squash the teams into illegible slivers. */}
      <div className="overflow-x-auto -mx-4 px-4 sm:-mx-1 sm:px-1 pb-3">
        <div
          ref={rootRef}
          className="relative w-full min-w-[72rem] lg:min-w-0"
          style={{ height: "clamp(720px, 80vh, 800px)" }}
        >
          {/* connectors (under the cells) */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: 0 }}
            aria-hidden
          >
            {geo.map((c, i) => {
              const decided = !!picks[c.up];
              let stroke = decided ? "var(--pitch)" : "var(--ink-soft)";
              let dash: string | undefined = decided ? undefined : "4 5";
              let op = decided ? 1 : 0.5;
              if (mode !== "build") {
                const r = results[c.up];
                if (r && r.status === "FINISHED") {
                  const ok = !!picks[c.up] && picks[c.up] === r.winnerTeamId;
                  stroke = ok ? "var(--pitch)" : "var(--red)";
                  dash = ok ? undefined : "5 5";
                  op = 1;
                }
              }
              return (
                <path
                  key={`${c.up}-${c.down}-${i}`}
                  d={c.d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={dash ? 2 : 3}
                  strokeDasharray={dash}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={op}
                />
              );
            })}
          </svg>

          {/* columns (above the svg) */}
          <div className="relative h-full flex items-stretch gap-3 sm:gap-4" style={{ zIndex: 1 }}>
            {renderColumn(LEFT.R32)}
            {renderColumn(LEFT.R16)}
            {renderColumn(LEFT.QF)}
            {renderColumn(LEFT.SF)}

            {/* centre: Final + Champion */}
            <div
              className="flex flex-col items-center justify-center gap-3 h-full min-w-0"
              style={{ flex: "1.5 1 0" }}
            >
              <div className="w-full flex flex-col items-center">
                <div className="font-mono-sticker text-[10px] font-bold tracking-[0.15em] text-ink-soft mb-1.5">
                  THE FINAL · +{STAGE_PTS.F}
                </div>
                <div data-slot="F" className="w-full max-w-[200px]">
                  <MatchCell
                    slot="F"
                    ctx={ctx}
                    mode={mode}
                    played={!!playedSlots["F"]}
                    locked={locked}
                    pending={pending}
                    result={results["F"]}
                    onPick={applyPick}
                    accentShadow="var(--gold)"
                  />
                </div>
              </div>
              <ChampionSticker
                wPick={picks["W"] ?? null}
                fPick={picks["F"] ?? null}
                teamById={teamById}
                mode={mode}
                result={results["W"]}
                editable={mode !== "live" && !playedSlots["W"]}
                pending={pending}
                onCrown={() => picks["F"] && applyPick("W", picks["F"]!)}
              />
            </div>

            {renderColumn(RIGHT.SF)}
            {renderColumn(RIGHT.QF)}
            {renderColumn(RIGHT.R16)}
            {renderColumn(RIGHT.R32)}
          </div>
        </div>
      </div>

      <p className="font-mono-sticker text-[11px] text-ink-soft">
        {mode === "build"
          ? "Round-of-32 ties fill in from the group stage (Winner / Runner-up / 3rd of each group) as those groups finish — then tap the winner and they flow into the next round. Slots you haven’t reached read “Winner of …”. Autosaves; locks at the deadline."
          : mode === "futures"
            ? "Future betting: tap the winner of any match that hasn’t kicked off — only teams still in the tournament are offered. Played matches are settled against the real result and stay locked; each remaining match locks at its own kickoff."
            : "Bracket locked. Each match banks its points or strikes your pick as results land — your downstream picks persist, they just stop scoring."}
      </p>
    </div>
  );
}

// ── A single match cell: two stacked team-lines (+ scored footer in live mode).
//    Sides that aren't known yet render their placeholder (downstream feeder
//    "Winner of Quarter-final 1", or an unresolved R32 side "To be decided"). ──
function MatchCell({
  slot,
  ctx,
  mode,
  played = false,
  locked,
  pending,
  result,
  onPick,
  accentShadow,
}: {
  slot: string;
  ctx: ResolveCtx;
  mode: BracketMode;
  /** Futures mode: this slot's real match has kicked off — settled, not bettable. */
  played?: boolean;
  locked: boolean;
  pending: boolean;
  result: SlotResult | undefined;
  onPick: (slot: string, teamId: string) => void;
  accentShadow?: string;
}) {
  const cont = contestantsFor(slot, ctx);
  const winner = ctx.picks[slot] ?? null;

  const knownTeamIds = cont.flatMap((c) => (c.kind === "team" ? [c.teamId] : []));
  const bothKnown = cont.length >= 2 && cont.every((c) => c.kind === "team");
  const stalePick = !!winner && knownTeamIds.length > 0 && !knownTeamIds.includes(winner);

  // Live mode scores everything; futures mode scores only the played slots
  // (the rest are still open bets).
  const scored =
    (mode === "live" || (mode === "futures" && played)) &&
    !!result &&
    result.status === "FINISHED";
  const realWinner = scored ? result!.winnerTeamId : null;
  const correct = scored && !!winner && winner === realWinner;
  const pts = bracketPointsForSlot(slot);
  const clickable = mode !== "live" && !locked && !played && bothKnown && !pending;
  // Futures: a played-but-unsettled slot (LIVE, or FINISHED with the winner not
  // yet filled in) is locked without a scored footer — flag why it won't tap.
  const inPlay = mode === "futures" && played && !scored;

  const edge = scored ? (correct ? "var(--pitch)" : "var(--red)") : winner ? "var(--pitch)" : "var(--ink)";
  const solid = scored || winner || bothKnown;

  const lineFor = (c: Contestant, key: number) => {
    if (c.kind !== "team") {
      return <TeamLine key={key} pendingLabel={pendingLabelFor(c)} />;
    }
    const team = ctx.teamById[c.teamId];
    if (!team) return <TeamLine key={key} pendingLabel={slotFriendlyName(slot)} />;
    let mark: TeamMark | undefined;
    let role: TeamRole = "option";
    if (scored) {
      mark = c.teamId === realWinner ? "realWinner" : c.teamId === winner ? "wrongPick" : "eliminated";
    } else if (winner) {
      role = c.teamId === winner ? "winner" : "loser";
    }
    return (
      <TeamLine
        key={key}
        team={team}
        role={role}
        mark={mark}
        clickable={clickable}
        onClick={clickable ? () => onPick(slot, c.teamId) : undefined}
      />
    );
  };

  return (
    <div
      className="bg-white rounded-[10px] border-2 border-ink overflow-hidden"
      style={{
        boxShadow: `3px 3px 0 ${scored || winner ? edge : accentShadow ?? "var(--ink)"}`,
        borderStyle: solid ? "solid" : "dashed",
      }}
    >
      {cont.map((c, i) => (
        <div key={i}>
          {i > 0 && <div className="h-0.5 bg-ink" style={{ opacity: solid ? 1 : 0.3 }} />}
          {lineFor(c, i)}
        </div>
      ))}
      {stalePick && !scored && !inPlay && (
        <div className="px-2 py-1 bg-coral text-white font-display uppercase text-[8px] tracking-wider text-center">
          Re-pick
        </div>
      )}
      {inPlay && (
        <div className="px-2 py-1 bg-paper-2 text-ink-soft font-mono-sticker text-[8px] font-bold tracking-wider text-center border-t-2 border-ink">
          🔒 KICKED OFF
        </div>
      )}
      {scored && (
        <div
          className="flex items-center justify-between gap-1.5 px-2 py-1 font-mono-sticker text-[9px] font-bold tracking-wide text-white"
          style={{ background: correct ? "var(--pitch)" : "var(--red)" }}
        >
          <span className="truncate">
            {correct
              ? `✓ ${scoreText(result!)}`
              : `✗ ${realWinner ? teamCode(ctx.teamById, realWinner) : "?"} ${scoreText(result!)}`}
          </span>
          <span className="font-display shrink-0">{correct ? `+${pts}` : "+0"}</span>
        </div>
      )}
    </div>
  );
}

function scoreText(r: SlotResult): string {
  return r.homeScore != null && r.awayScore != null ? `${r.homeScore}–${r.awayScore}` : "";
}

type TeamRole = "winner" | "option" | "loser";
type TeamMark = "realWinner" | "wrongPick" | "eliminated";

function TeamLine({
  team,
  pendingLabel,
  role = "option",
  mark,
  clickable,
  onClick,
}: {
  team?: BracketTeam;
  pendingLabel?: string;
  role?: TeamRole;
  mark?: TeamMark;
  clickable?: boolean;
  onClick?: () => void;
}) {
  if (pendingLabel) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 text-ink-soft">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded border-2 border-dashed border-ink-soft font-display text-[11px] shrink-0">
          ?
        </span>
        <span className="font-mono-sticker text-[9.5px] font-medium leading-tight text-ink">
          {pendingLabel}
        </span>
      </div>
    );
  }
  if (!team) return null;

  const isReal = mark === "realWinner";
  const isWrong = mark === "wrongPick";
  const label = team.code ?? team.short_name ?? team.name;

  if (mark) {
    return (
      <div
        className="flex items-center gap-2 px-2 py-1.5 w-full"
        style={{
          background: isReal ? "color-mix(in srgb, var(--pitch-light) 45%, transparent)" : "transparent",
          opacity: mark === "eliminated" ? 0.5 : 1,
        }}
      >
        <CountryFlag
          crestUrl={team.crest_url}
          code={team.code}
          name={team.name}
          size={18}
          className={isWrong ? "grayscale opacity-60" : undefined}
        />
        <span
          className={[
            "font-display uppercase text-[12px] tracking-wide flex-1 leading-none truncate",
            isWrong ? "line-through text-ink-soft" : "text-ink",
          ].join(" ")}
        >
          {label}
        </span>
        {isReal && <span className="badge badge-pitch !py-0 !px-1.5 !text-[8px]">✓ Won</span>}
        {isWrong && (
          <span className="font-display uppercase text-[8px] tracking-wide text-red shrink-0">
            Your pick
          </span>
        )}
      </div>
    );
  }

  const isWinner = role === "winner";
  const isLoser = role === "loser";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={[
        "flex items-center gap-2 px-2 py-1.5 w-full text-left transition-transform",
        isWinner ? "bg-gold" : "bg-transparent",
        isLoser ? "text-ink-soft opacity-55" : "text-ink",
        clickable ? "cursor-pointer hover:-translate-x-px hover:-translate-y-px" : "cursor-default",
      ].join(" ")}
    >
      <CountryFlag crestUrl={team.crest_url} code={team.code} name={team.name} size={18} />
      <span className="font-display uppercase text-[12px] tracking-wide flex-1 leading-none truncate">
        {label}
      </span>
      {isWinner && <span className="badge badge-pitch !py-0 !px-1.5 !text-[8px]">✓</span>}
    </button>
  );
}

function ChampionSticker({
  wPick,
  fPick,
  teamById,
  mode,
  result,
  editable,
  pending,
  onCrown,
}: {
  wPick: string | null;
  fPick: string | null;
  teamById: Record<string, BracketTeam>;
  mode: BracketMode;
  result: SlotResult | undefined;
  /** Crown still changeable — build phase, or futures with the Final unplayed. */
  editable: boolean;
  pending: boolean;
  onCrown: () => void;
}) {
  const champTeam = wPick ? teamById[wPick] : undefined;
  const scored = mode !== "build" && !!result && result.status === "FINISHED";
  const realChamp = scored ? result!.winnerTeamId : null;
  const champCorrect = scored && !!wPick && wPick === realChamp;
  const champMissed = scored && !!wPick && wPick !== realChamp;
  const pts = POINTS.bracket.WINNER;

  // Crowned champion sticker.
  if (champTeam) {
    return (
      <div className="w-full max-w-[200px]">
        <div
          className={`${champMissed ? "" : "holo"} relative border-2 border-ink rounded-[14px] px-3 py-3 text-center`}
          style={{
            background: champMissed ? "var(--white)" : "var(--gold)",
            boxShadow: `5px 5px 0 ${champMissed ? "var(--red)" : "var(--coral)"}`,
          }}
        >
          <span
            className="inline-block font-display text-[10px] tracking-[0.12em] px-2.5 py-0.5 rounded-full -rotate-3"
            style={{
              background: champMissed ? "var(--red)" : "var(--ink)",
              color: champMissed ? "var(--white)" : "var(--gold)",
            }}
          >
            {champMissed ? "✗ Not your call" : champCorrect ? "★ Champion ✓" : "★ Champion ★"}
          </span>
          <div className="mt-2 flex justify-center">
            <CountryFlag
              crestUrl={champTeam.crest_url}
              code={champTeam.code}
              name={champTeam.name}
              size={44}
              className={champMissed ? "grayscale opacity-60" : undefined}
            />
          </div>
          <div
            className={[
              "font-display uppercase text-lg tracking-tight mt-1 leading-none",
              champMissed ? "line-through text-ink-soft" : "text-ink",
            ].join(" ")}
          >
            {champTeam.name}
          </div>
          {champMissed ? (
            <div className="mt-2 font-mono-sticker text-[10px] font-bold text-ink">
              Actual: {realChamp ? teamCode(teamById, realChamp) : "?"} · +0
            </div>
          ) : (
            <div className="mt-2 inline-block badge badge-ink !text-[10px]">
              {champCorrect ? `+${pts} pts ✓` : `+${pts} pts`}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Final winner picked but not yet crowned → offer the crown while editable.
  if (editable && fPick) {
    const f = teamById[fPick];
    return (
      <button
        type="button"
        onClick={onCrown}
        disabled={pending}
        className="w-full max-w-[200px] border-2 border-dashed border-ink rounded-[14px] px-3 py-3 text-center bg-white cursor-pointer transition-transform hover:-translate-x-px hover:-translate-y-px disabled:opacity-60"
        style={{ boxShadow: "4px 4px 0 var(--gold)" }}
      >
        <span className="inline-block badge badge-gold -rotate-2">👑 Crown champion</span>
        <div className="mt-2 flex items-center justify-center gap-2">
          {f && <CountryFlag crestUrl={f.crest_url} code={f.code} name={f.name} size={28} />}
          <span className="font-display uppercase text-sm tracking-tight">{f?.name ?? ""}</span>
        </div>
        <div className="mt-1 font-mono-sticker text-[10px] font-bold text-pitch">Tap to bank +{pts}</div>
      </button>
    );
  }

  // Pending — nothing crowned yet.
  return (
    <div
      className="w-full max-w-[200px] border-2 border-dashed border-ink rounded-[14px] px-3 py-3 text-center bg-white"
      style={{ boxShadow: "4px 4px 0 var(--gold)" }}
    >
      <span className="inline-block badge badge-gold -rotate-2">🏆 Champion</span>
      <div className="my-2 font-mono-sticker text-[10px] text-ink-soft font-semibold leading-snug">
        Crown your winner once
        <br />
        the final is set
      </div>
    </div>
  );
}

// Header chip reflecting the bracket lifecycle phase.
function StatusPill({
  mode,
  results,
  slotsByStage,
}: {
  mode: BracketMode;
  results: Record<string, SlotResult>;
  slotsByStage: Record<BracketStage, string[]>;
}) {
  let text: string;
  let cls = "badge badge-gold";
  if (mode === "build") {
    text = "Round 2 · Knockouts";
    cls = "badge badge-coral";
  } else if (mode === "futures") {
    text = "🔮 Future betting open";
  } else {
    const finalDone = results["F"]?.status === "FINISHED";
    if (finalDone) {
      text = "★ Tournament complete";
    } else {
      // name the latest round with any result in.
      const live = (["SF", "QF", "R16", "R32"] as BracketStage[]).find((st) =>
        (slotsByStage[st] ?? []).some((s) => results[s]?.status === "FINISHED"),
      );
      text = live ? `● Live · ${stageFullLabel(live)} in` : "Bracket locked · awaiting kickoff";
      cls = live ? "badge badge-coral" : "badge";
    }
  }
  return (
    <span className={`${cls} -rotate-2`} style={{ boxShadow: "3px 3px 0 var(--ink)" }}>
      {text}
    </span>
  );
}

function stageFullLabel(s: BracketStage): string {
  return { R32: "Round of 32", R16: "Round of 16", QF: "Quarter-finals", SF: "Semi-finals", F: "Final", W: "Champion" }[s];
}

function StageLegend() {
  return (
    <div
      className="flex items-center border-2 border-ink rounded-full overflow-hidden"
      style={{ boxShadow: "3px 3px 0 var(--ink)" }}
    >
      {(["R32", "R16", "QF", "SF", "F"] as BracketStage[]).map((s, i) => (
        <span
          key={s}
          className={`px-2 py-1 font-mono-sticker text-[9px] font-bold tracking-wide text-ink-soft ${i % 2 ? "bg-paper-2" : "bg-white"}`}
        >
          {s}
          <b className="text-pitch"> +{STAGE_PTS[s]}</b>
        </span>
      ))}
    </div>
  );
}

function PointsHUD({
  score,
}: {
  score: { banked: number; perStage: Record<string, { correct: number; total: number; revealed: boolean; perfect: boolean }>; maxPossible: number };
}) {
  return (
    <div
      className="flex items-center gap-3 bg-white border-2 border-ink rounded-xl px-3 py-2"
      style={{ boxShadow: "3px 3px 0 var(--ink)" }}
    >
      <div className="flex flex-col leading-none">
        <span className="font-display text-2xl tracking-tight">{score.banked}</span>
        <span className="font-mono-sticker text-[8px] text-ink-soft font-bold tracking-wide">
          PTS · /{score.maxPossible}
        </span>
      </div>
      <div className="w-0.5 self-stretch bg-ink opacity-15" />
      <div className="flex gap-2.5">
        {(["R32", "R16", "QF", "SF", "F"] as BracketStage[]).map((st) => {
          const ps = score.perStage[st];
          return (
            <div key={st} className="text-center" style={{ opacity: ps.revealed ? 1 : 0.4 }}>
              <div className="font-mono-sticker text-[8px] font-bold text-ink-soft">{st}</div>
              <div className={`font-display text-[13px] ${ps.perfect ? "text-pitch" : "text-ink"}`}>
                {ps.revealed ? `${ps.correct}/${ps.total}` : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
