"use client";

import { useState, useTransition } from "react";
import { setMatchPick } from "@/lib/predictions/actions";
import type { Pick1X2 } from "@/lib/supabase/types";
import { CountryFlag } from "@/components/CountryFlag";
import { isoToLocal } from "@/lib/utils";
import { Handshake, Check } from "lucide-react";

interface Team {
  id: string;
  name: string;
  short_name: string | null;
  code: string;
  crest_url: string | null;
}

export interface MatchPickRow {
  id: string;
  kickoff_at: string;
  group_letter: string | null;
  home: Team | null;
  away: Team | null;
}

interface Props {
  match: MatchPickRow;
  initialPick: Pick1X2 | null;
  locked: boolean;
}

export function MatchPickCard({ match, initialPick, locked }: Props) {
  const [pick, setPick] = useState<Pick1X2 | null>(initialPick);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(value: Pick1X2) {
    if (locked || pending) return;
    const previous = pick;
    setPick(value);
    setError(null);
    startTransition(async () => {
      const result = await setMatchPick(match.id, value);
      if (!result.ok) {
        setPick(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <span>
          {match.group_letter ? `Group ${match.group_letter} · ` : ""}
          {isoToLocal(match.kickoff_at)}
        </span>
        {locked && <span className="badge">Locked</span>}
        {!locked && pick && (
          <span className="badge text-[var(--accent)]">
            <Check className="w-3 h-3" /> Saved
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <PickTile
          selected={pick === "HOME"}
          disabled={locked}
          label={match.home?.short_name ?? match.home?.name ?? "Home"}
          flag={
            match.home ? (
              <CountryFlag
                crestUrl={match.home.crest_url}
                code={match.home.code}
                name={match.home.name}
                size={56}
              />
            ) : null
          }
          onClick={() => choose("HOME")}
        />
        <PickTile
          selected={pick === "DRAW"}
          disabled={locked}
          label="Draw"
          flag={<Handshake className="w-7 h-7 text-[var(--muted)]" />}
          onClick={() => choose("DRAW")}
        />
        <PickTile
          selected={pick === "AWAY"}
          disabled={locked}
          label={match.away?.short_name ?? match.away?.name ?? "Away"}
          flag={
            match.away ? (
              <CountryFlag
                crestUrl={match.away.crest_url}
                code={match.away.code}
                name={match.away.name}
                size={56}
              />
            ) : null
          }
          onClick={() => choose("AWAY")}
        />
      </div>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}

function PickTile({
  label,
  flag,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  flag: React.ReactNode;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-xl border transition-all",
        "min-h-[110px] text-center",
        selected
          ? "bg-[color:var(--accent)]/15 border-[var(--accent)] text-[var(--foreground)]"
          : "bg-[var(--surface-2)] border-[var(--border)] hover:border-[var(--accent)]/60",
        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer active:scale-[0.98]",
      ].join(" ")}
    >
      <div className="flex items-center justify-center">{flag}</div>
      <span className="text-sm font-medium leading-tight">{label}</span>
    </button>
  );
}
