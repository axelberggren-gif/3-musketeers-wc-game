"use client";

import { useState, useTransition } from "react";
import { setManualPropResolutions } from "@/lib/admin/actions";

interface TeamOpt {
  id: string;
  name: string;
  code: string;
}
interface PlayerOpt {
  id: string;
  name: string;
}
interface MatchOpt {
  id: string;
  label: string;
}

export function ManualPropsForm({
  teams,
  players,
  groupMatches,
  current,
}: {
  teams: TeamOpt[];
  players: PlayerOpt[];
  groupMatches: MatchOpt[];
  current: {
    neymar_minutes: string;
    streaker: string;
    best_goalkeeper_player_id: string;
    golden_boot_team_id: string;
    own_goals: string;
    war_game_match_id: string;
    swedish_players: string;
  };
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handle(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await setManualPropResolutions(formData);
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  return (
    <form action={handle} className="card flex flex-col gap-4">
      <YesNo
        name="neymar_minutes"
        label="Neymar: 30 minutes or less, total?"
        yes="Yes — 30 min or less"
        no="No — he plays more"
        defaultValue={current.neymar_minutes}
      />
      <YesNo
        name="streaker"
        label="Streaker on the pitch?"
        yes="Yes — someone runs"
        no="No streaker"
        defaultValue={current.streaker}
      />

      <div className="flex flex-col gap-1">
        <label className="label">Goalkeeper with the most clean sheets</label>
        <select name="best_goalkeeper_player_id" defaultValue={current.best_goalkeeper_player_id} className="input">
          <option value="">— unresolved —</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="label">Top-scoring nation (golden boot, team edition)</label>
        <select name="golden_boot_team_id" defaultValue={current.golden_boot_team_id} className="input">
          <option value="">— unresolved —</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <NumberField
        name="own_goals"
        label="Own goals, whole tournament (closest guess wins)"
        defaultValue={current.own_goals}
      />

      <div className="flex flex-col gap-1">
        <label className="label">War game — group match with the most cards</label>
        <select name="war_game_match_id" defaultValue={current.war_game_match_id} className="input">
          <option value="">{groupMatches.length === 0 ? "— fixtures not loaded yet —" : "— unresolved —"}</option>
          {groupMatches.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <NumberField
        name="swedish_players"
        label="Different Swedish players with playtime (closest guess wins)"
        defaultValue={current.swedish_players}
      />

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      {saved && <p className="text-sm text-[var(--accent)]">Saved and re-scored.</p>}
      <button type="submit" disabled={pending} className="btn btn-primary self-start">
        {pending ? "Saving…" : "Save results + re-score"}
      </button>
    </form>
  );
}

function YesNo({
  name,
  label,
  yes,
  no,
  defaultValue,
}: {
  name: string;
  label: string;
  yes: string;
  no: string;
  defaultValue: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="label">{label}</label>
      <select name={name} defaultValue={defaultValue} className="input">
        <option value="">— unresolved —</option>
        <option value="yes">{yes}</option>
        <option value="no">{no}</option>
      </select>
    </div>
  );
}

function NumberField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="label">{label}</label>
      <input
        type="number"
        min={0}
        max={50}
        name={name}
        defaultValue={defaultValue}
        placeholder="unresolved"
        className="input"
      />
    </div>
  );
}
