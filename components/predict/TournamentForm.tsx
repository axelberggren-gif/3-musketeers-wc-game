"use client";

import { setTournamentPick, setPlayerProp } from "@/lib/predictions/actions";
import { TeamSelect, type TeamOption } from "./TeamSelect";
import { PlayerSelect, type PlayerOption } from "./PlayerSelect";

interface Props {
  teams: TeamOption[];
  players: PlayerOption[];
  initial: {
    winner_team_id: string | null;
    runner_up_team_id: string | null;
    top_scorer_player_id: string | null;
    dark_horse_team_id: string | null;
  };
  propPicks: Record<string, string | null>;
  propDefs: { key: string; label: string }[];
  locked: boolean;
}

export function TournamentForm({ teams, players, initial, propPicks, propDefs, locked }: Props) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <TeamSelect
        label="Tournament winner (25 pts)"
        options={teams}
        initial={initial.winner_team_id}
        disabled={locked}
        onSave={(id) => setTournamentPick({ winner_team_id: id })}
      />
      <TeamSelect
        label="Runner-up (10 pts)"
        options={teams}
        initial={initial.runner_up_team_id}
        disabled={locked}
        onSave={(id) => setTournamentPick({ runner_up_team_id: id })}
      />
      <TeamSelect
        label="Dark horse — reaches SF (10 pts)"
        options={teams}
        initial={initial.dark_horse_team_id}
        disabled={locked}
        onSave={(id) => setTournamentPick({ dark_horse_team_id: id })}
      />
      <PlayerSelect
        label="Golden boot — top scorer (15 pts)"
        options={players}
        initial={initial.top_scorer_player_id}
        disabled={locked}
        onSave={(id) => setTournamentPick({ top_scorer_player_id: id })}
      />
      {propDefs.map((p) => (
        <PlayerSelect
          key={p.key}
          label={`${p.label} (10 pts)`}
          options={players}
          initial={propPicks[p.key] ?? null}
          disabled={locked}
          onSave={async (id) => {
            if (!id) return { ok: true };
            return setPlayerProp(p.key, id);
          }}
        />
      ))}
    </div>
  );
}
