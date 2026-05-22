"use client";

import { setGroupWinnerPick } from "@/lib/predictions/actions";
import { TeamSelect, type TeamOption } from "./TeamSelect";

interface Props {
  teamsByGroup: Record<string, TeamOption[]>;
  initial: Record<string, string | null>;
  locked: boolean;
}

const GROUP_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;

export function GroupWinnerPicker({ teamsByGroup, initial, locked }: Props) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {GROUP_LETTERS.map((letter) => {
        const options = teamsByGroup[letter] ?? [];
        if (options.length === 0) return null;
        return (
          <TeamSelect
            key={letter}
            label={`Group ${letter} winner (5 pts)`}
            options={options}
            initial={initial[letter] ?? null}
            disabled={locked}
            onSave={(id) => setGroupWinnerPick(letter, id)}
          />
        );
      })}
    </div>
  );
}
