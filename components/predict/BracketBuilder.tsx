"use client";

import { useMemo, useState, useTransition } from "react";
import {
  clearBracketPicks,
  setBracketPick,
  setBracketPicksBulk,
} from "@/lib/predictions/actions";
import { CountryFlag } from "@/components/CountryFlag";
import { BRACKET_UPSTREAM, upstreamSlots } from "@/lib/scoring/bracket-tree";

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

interface Props {
  slots: BracketSlot[];
  teams: BracketTeam[];
  initial: Record<string, string | null>;
  locked: boolean;
  r32Suggestions: { slot: string; teamId: string }[];
}

const STAGE_ORDER: BracketStage[] = ["R32", "R16", "QF", "SF", "F", "W"];

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

export function BracketBuilder({ slots, teams, initial, locked, r32Suggestions }: Props) {
  const [picks, setPicks] = useState<Record<string, string | null>>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const teamById = useMemo(
    () => Object.fromEntries(teams.map((t) => [t.id, t])),
    [teams],
  );

  const grouped = slots.reduce<Record<string, BracketSlot[]>>((acc, s) => {
    (acc[s.stage] ??= []).push(s);
    return acc;
  }, {});

  const slotIds = useMemo(() => new Set(slots.map((s) => s.slot)), [slots]);
  const validSuggestions = useMemo(
    () => r32Suggestions.filter((q) => slotIds.has(q.slot)),
    [r32Suggestions, slotIds],
  );

  function optionsFor(slot: BracketSlot): BracketTeam[] {
    const ups = upstreamSlots(slot.slot);
    if (ups.length === 0) return teams;
    const pool = ups
      .map((u) => picks[u])
      .filter((id): id is string => !!id)
      .map((id) => teamById[id])
      .filter((t): t is BracketTeam => !!t);
    return pool;
  }

  function applyPick(slot: string, teamId: string) {
    const previous = { ...picks };
    const invalidatedDownstream = collectDownstream(slot).filter((ds) => {
      const ups = upstreamSlots(ds);
      const newWinners = new Set(
        ups.map((u) => (u === slot ? teamId : picks[u])).filter(Boolean),
      );
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
  }

  function applySuggestions() {
    const filtered = validSuggestions.filter((q) => !picks[q.slot]);
    if (filtered.length === 0) return;
    const previous = { ...picks };
    const next = { ...picks };
    for (const q of filtered) next[q.slot] = q.teamId;
    setPicks(next);
    setError(null);
    startTransition(async () => {
      const result = await setBracketPicksBulk(filtered);
      if (!result.ok) {
        setPicks(previous);
        setError(result.error);
      }
    });
  }

  const suggestableCount = validSuggestions.filter((q) => !picks[q.slot]).length;

  return (
    <div className="flex flex-col gap-4">
      {validSuggestions.length > 0 && !locked && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 bg-paper-2 border-2 border-ink rounded-xl px-4 py-3"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          <p className="text-xs text-ink-soft max-w-md">
            Based on your group-stage picks, suggest 16 likely R32 winners (top advancers across
            all groups by predicted points). Fill empty R32 slots only — won&rsquo;t overwrite
            picks.
          </p>
          <button
            type="button"
            onClick={applySuggestions}
            disabled={pending || suggestableCount === 0}
            className="badge badge-pitch font-display uppercase text-xs px-3 py-1.5 disabled:opacity-50"
            style={{ boxShadow: "3px 3px 0 var(--ink)" }}
          >
            {suggestableCount === 0
              ? "All R32 slots filled"
              : `Suggest ${suggestableCount} qualifier${suggestableCount === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
      {error && (
        <p className="text-xs text-red font-medium border-2 border-red rounded-xl px-3 py-2 bg-paper-2">
          {error}
        </p>
      )}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6">
        {STAGE_ORDER.map((stage) =>
          grouped[stage] ? (
            <div key={stage} className="flex flex-col gap-3">
              <h3
                className="font-display uppercase text-xs tracking-widest text-ink bg-paper-2 border-2 border-ink rounded-full px-3 py-1 self-start"
                style={{ boxShadow: "3px 3px 0 var(--ink)" }}
              >
                {stageLabel(stage)}
              </h3>
              {grouped[stage].map((s) => (
                <SlotCard
                  key={s.slot}
                  slot={s}
                  options={optionsFor(s)}
                  value={picks[s.slot] ?? null}
                  selectedTeam={picks[s.slot] ? teamById[picks[s.slot]!] : undefined}
                  pending={pending}
                  locked={locked}
                  onPick={(teamId) => applyPick(s.slot, teamId)}
                />
              ))}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

function stageLabel(s: BracketStage) {
  switch (s) {
    case "R32":
      return "Round of 32";
    case "R16":
      return "Round of 16";
    case "QF":
      return "Quarter-finals";
    case "SF":
      return "Semi-finals";
    case "F":
      return "Final";
    case "W":
      return "Champion";
  }
}

function SlotCard({
  slot,
  options,
  value,
  selectedTeam,
  pending,
  locked,
  onPick,
}: {
  slot: BracketSlot;
  options: BracketTeam[];
  value: string | null;
  selectedTeam: BracketTeam | undefined;
  pending: boolean;
  locked: boolean;
  onPick: (teamId: string) => void;
}) {
  const isChampion = slot.stage === "W";
  const upstreamEmpty = options.length === 0 && slot.stage !== "R32";

  return (
    <div
      className={[
        "rounded-xl border-2 border-ink p-3 flex flex-col gap-2",
        selectedTeam ? "bg-white" : "bg-paper-2",
      ].join(" ")}
      style={{
        boxShadow: selectedTeam
          ? isChampion
            ? "5px 5px 0 var(--gold)"
            : "4px 4px 0 var(--ink)"
          : "3px 3px 0 var(--ink)",
        borderStyle: selectedTeam ? "solid" : "dashed",
      }}
    >
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-mono-sticker uppercase tracking-widest text-ink-soft font-medium">
          {slot.label}
        </span>
        {locked ? (
          <span className="badge badge-ink !py-0 !text-[10px]">Locked</span>
        ) : value ? (
          <span className="badge badge-pitch !py-0 !text-[10px]">✓</span>
        ) : null}
      </div>
      {selectedTeam ? (
        <div className="flex items-center gap-2">
          <CountryFlag
            crestUrl={selectedTeam.crest_url}
            code={selectedTeam.code}
            name={selectedTeam.name}
            size={28}
          />
          <span className="font-display uppercase text-sm tracking-wide">
            {selectedTeam.short_name ?? selectedTeam.name}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-ink-soft">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-md border-2 border-dashed border-ink-soft font-display text-base">
            ?
          </span>
          <span className="text-xs font-medium">
            {upstreamEmpty ? "Pick upstream first" : "Not picked"}
          </span>
        </div>
      )}
      <select
        value={value ?? ""}
        onChange={(e) => {
          const next = e.target.value;
          if (next) onPick(next);
        }}
        disabled={locked || pending || upstreamEmpty}
        className="input !text-xs !py-1.5"
        style={{ boxShadow: "2px 2px 0 var(--ink)" }}
      >
        <option value="">— pick a team —</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}
