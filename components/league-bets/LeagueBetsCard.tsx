"use client";

import { usePathname } from "next/navigation";
import { LeagueMemberSelect, type MemberOption } from "./LeagueMemberSelect";
import { VoteBadges } from "./VoteBadges";
import { setLeagueBet } from "@/lib/league-bets/actions";
import { BET_EMOJI, type VoteTally } from "@/lib/league-bets/shared";

interface Props {
  leagueId: string;
  /** Shown as a heading when several leagues stack (e.g. the Outcomes tab). */
  leagueName?: string;
  /** All members of the league (incl. self), used for options + tally labels. */
  members: MemberOption[];
  selfId: string;
  initial: { most_points: string | null; least_points: string | null };
  /** Per-member vote counts; null hides the tally (kept secret until lock). */
  tallies: Record<string, VoteTally> | null;
  locked: boolean;
}

// The two league-internal bets for one league: crown (most points) + wooden
// spoon (least points). Used on both the league page and the Outcomes tab.
export function LeagueBetsCard({
  leagueId,
  leagueName,
  members,
  selfId,
  initial,
  tallies,
  locked,
}: Props) {
  const pathname = usePathname();
  const others = members.filter((m) => m.id !== selfId);

  return (
    <div className="card flex flex-col gap-4" style={{ boxShadow: "6px 6px 0 var(--mag)" }}>
      {leagueName ? (
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display uppercase tracking-wide text-sm truncate">{leagueName}</h3>
          <span className="badge badge-ink shrink-0">League bets</span>
        </div>
      ) : null}

      {others.length === 0 ? (
        <p className="text-sm text-ink-soft">
          Invite more members and you can call who tops — and flops — the group stage.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          <BetTile
            emoji={BET_EMOJI.most_points}
            title="Group-stage king"
            points="−5 / vote if they win"
            hint="Who tops the group stage? If your pick finishes top, they lose 5 pts per crown — so this is how you handicap the favourite."
            accent="var(--gold)"
            locked={locked}
            options={others}
            initial={initial.most_points}
            onSave={(id) => setLeagueBet(leagueId, "most_points", id, pathname)}
          />
          <BetTile
            emoji={BET_EMOJI.least_points}
            title="Wooden spoon"
            points="+5 if right"
            hint="Who finishes bottom of the group stage? Call it right for +5. The actual loser still pockets 2 pts per 💩 as a pity prize."
            accent="var(--coral)"
            locked={locked}
            options={others}
            initial={initial.least_points}
            onSave={(id) => setLeagueBet(leagueId, "least_points", id, pathname)}
          />
        </div>
      )}

      {locked && tallies ? (
        <TallyList members={members} tallies={tallies} />
      ) : !locked && others.length > 0 ? (
        <p className="font-mono-sticker text-[0.6rem] uppercase tracking-[0.18em] text-ink-soft">
          Votes stay secret until the first kickoff.
        </p>
      ) : null}
    </div>
  );
}

function BetTile({
  emoji,
  title,
  points,
  hint,
  accent,
  locked,
  options,
  initial,
  onSave,
}: {
  emoji: string;
  title: string;
  points: string;
  hint: string;
  accent: string;
  locked: boolean;
  options: MemberOption[];
  initial: string | null;
  onSave: (id: string | null) => Promise<{ ok: boolean; error?: string }>;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border-2 border-ink bg-paper-2 p-3"
      style={{ boxShadow: `3px 3px 0 ${accent}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl leading-none" aria-hidden>
            {emoji}
          </span>
          <h4 className="font-display uppercase tracking-wide text-xs leading-tight">{title}</h4>
        </div>
        <span className="badge badge-ink shrink-0 whitespace-nowrap text-[10px]">{points}</span>
      </div>
      <p className="text-xs text-ink-soft leading-snug">{hint}</p>
      <div className="mt-auto">
        <LeagueMemberSelect options={options} initial={initial} disabled={locked} onSave={onSave} />
      </div>
    </div>
  );
}

function TallyList({
  members,
  tallies,
}: {
  members: MemberOption[];
  tallies: Record<string, VoteTally>;
}) {
  const voted = members
    .map((m) => ({ ...m, ...(tallies[m.id] ?? { crown: 0, poop: 0 }) }))
    .filter((m) => m.crown > 0 || m.poop > 0)
    .sort((a, b) => b.crown + b.poop - (a.crown + a.poop));

  return (
    <div className="flex flex-col gap-1.5 border-t-2 border-ink pt-3">
      <span className="font-mono-sticker text-[0.6rem] uppercase tracking-[0.18em] text-ink-soft">
        The votes are in
      </span>
      {voted.length === 0 ? (
        <p className="text-xs text-ink-soft">Nobody got a vote.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {voted.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2">
              <span className="font-display uppercase text-xs tracking-wide truncate">{m.label}</span>
              <VoteBadges crown={m.crown} poop={m.poop} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
