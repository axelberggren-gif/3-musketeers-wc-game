"use client";

import { useState } from "react";
import {
  setTournamentPick,
  setPlayerProp,
  setTotalGoalsGuess,
  setHighestMatchGoalsGuess,
  setFirstEliminatedPick,
  setFinalGoalsGuess,
  setBiggestWinMarginGuess,
  setGoldenBootGoalsGuess,
  setTotalRedCardsGuess,
  setNeymarMinutesPick,
  setStreakerPick,
  setBestGoalkeeperPick,
  setGoldenBootTeamPick,
  setWarGamePick,
  setOwnGoalsGuess,
  setSwedishPlayersGuess,
} from "@/lib/predictions/actions";
import { TeamSelect, type TeamOption } from "./TeamSelect";
import { PlayerSelect, type PlayerOption } from "./PlayerSelect";
import { NumberInput } from "./NumberInput";
import { BooleanSelect } from "./BooleanSelect";
import { MatchSelect, type MatchOption } from "./MatchSelect";
import { LeagueBetsCard } from "@/components/league-bets/LeagueBetsCard";
import type { VoteTally } from "@/lib/league-bets/shared";

type SaveResult = { ok: boolean; error?: string };

interface Props {
  teams: TeamOption[];
  players: PlayerOption[];
  groupMatches: MatchOption[];
  initial: {
    winner_team_id: string | null;
    runner_up_team_id: string | null;
    top_scorer_player_id: string | null;
    dark_horse_team_id: string | null;
    first_eliminated_team_id: string | null;
    total_goals_guess: number | null;
    highest_match_goals_guess: number | null;
    final_goals_guess: number | null;
    biggest_win_margin_guess: number | null;
    golden_boot_goals_guess: number | null;
    total_red_cards_guess: number | null;
    neymar_minutes_pick: boolean | null;
    streaker_pick: boolean | null;
    best_goalkeeper_player_id: string | null;
    golden_boot_team_id: string | null;
    own_goals_guess: number | null;
    war_game_match_id: string | null;
    swedish_players_guess: number | null;
  };
  propPicks: Record<string, string | null>;
  propDefs: { key: string; label: string }[];
  locked: boolean;
  // One entry per league the user belongs to — the internal-league-bets zone.
  leagueBets: {
    leagueId: string;
    leagueName: string;
    members: { id: string; label: string }[];
    selfId: string;
    initial: { most_points: string | null; least_points: string | null };
    tallies: Record<string, VoteTally> | null;
  }[];
}

type Accent = "ink" | "gold" | "coral" | "pitch" | "blue" | "mag";

const ACCENT_SHADOW: Record<Accent, string> = {
  ink: "6px 6px 0 var(--ink)",
  gold: "6px 6px 0 var(--gold)",
  coral: "6px 6px 0 var(--coral)",
  pitch: "6px 6px 0 var(--pitch)",
  blue: "6px 6px 0 var(--blue)",
  mag: "6px 6px 0 var(--mag)",
};

export function OutcomesBoard({
  teams,
  players,
  groupMatches,
  initial,
  propPicks,
  propDefs,
  locked,
  leagueBets,
}: Props) {
  // One flat map of every pick → filled? — drives the betting-slip meter. Built
  // up front so it contains *every* key (false ones included) and the totals are
  // just key/value counts.
  const [filled, setFilled] = useState<Record<string, boolean>>(() => {
    const f: Record<string, boolean> = {
      winner: initial.winner_team_id != null,
      runner_up: initial.runner_up_team_id != null,
      dark_horse: initial.dark_horse_team_id != null,
      top_scorer: initial.top_scorer_player_id != null,
      troublemaker: propPicks["troublemaker"] != null,
      first_eliminated: initial.first_eliminated_team_id != null,
      total_goals: initial.total_goals_guess != null,
      highest_match: initial.highest_match_goals_guess != null,
      final_goals: initial.final_goals_guess != null,
      win_margin: initial.biggest_win_margin_guess != null,
      golden_boot_goals: initial.golden_boot_goals_guess != null,
      red_cards: initial.total_red_cards_guess != null,
      neymar: initial.neymar_minutes_pick != null,
      streaker: initial.streaker_pick != null,
      best_gk: initial.best_goalkeeper_player_id != null,
      golden_boot_team: initial.golden_boot_team_id != null,
      own_goals: initial.own_goals_guess != null,
      war_game: initial.war_game_match_id != null,
      swedish_players: initial.swedish_players_guess != null,
    };
    for (const p of propDefs) f[`prop:${p.key}`] = propPicks[p.key] != null;
    return f;
  });

  // Wrap a server action so a successful save updates the meter. Mirrors the
  // optimistic pattern in the selectors — they already roll back on !ok, so we
  // only flip the meter bit on ok.
  function trackStr(key: string, action: (id: string | null) => Promise<SaveResult>) {
    return async (id: string | null) => {
      const res = await action(id);
      if (res.ok) setFilled((f) => ({ ...f, [key]: id != null && id !== "" }));
      return res;
    };
  }
  function trackNum(key: string, action: (v: number | null) => Promise<SaveResult>) {
    return async (v: number | null) => {
      const res = await action(v);
      if (res.ok) setFilled((f) => ({ ...f, [key]: v != null }));
      return res;
    };
  }
  function trackBool(key: string, action: (v: boolean | null) => Promise<SaveResult>) {
    return async (v: boolean | null) => {
      const res = await action(v);
      if (res.ok) setFilled((f) => ({ ...f, [key]: v != null }));
      return res;
    };
  }
  // Clearing a player prop deletes the row server-side (setPlayerProp(null))
  // so the pick doesn't reappear on reload; the meter bit follows the save.
  function trackProp(key: string) {
    return async (id: string | null) => {
      const res: SaveResult = await setPlayerProp(key, id);
      if (res.ok) setFilled((f) => ({ ...f, [`prop:${key}`]: id != null && id !== "" }));
      return res;
    };
  }

  const total = Object.keys(filled).length;
  const done = Object.values(filled).filter(Boolean).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="flex flex-col gap-8">
      {/* Betting-slip completion meter */}
      <div className="card flex flex-col gap-3" style={{ boxShadow: "6px 6px 0 var(--coral)" }}>
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="flex flex-col">
            <span className="font-mono-sticker text-[0.65rem] uppercase tracking-[0.2em] text-ink-soft">
              Your betting slip
            </span>
            <span className="font-display text-2xl leading-none">
              {done}
              <span className="text-ink-soft text-lg"> / {total} calls in</span>
            </span>
          </div>
          <span
            className="font-display text-3xl leading-none text-coral"
            aria-hidden
          >
            {pct}%
          </span>
        </div>
        <div className="h-3 rounded-full border-2 border-ink bg-paper-2 overflow-hidden">
          <div
            className="h-full bg-pitch transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {locked ? (
          <p className="font-mono-sticker text-[0.65rem] uppercase tracking-widest text-coral">
            🔒 Locked — Round 1 has kicked off. These are your final calls.
          </p>
        ) : (
          <p className="text-xs text-ink-soft">
            Every pick autosaves. Change them any time before the first kickoff.
          </p>
        )}
      </div>

      {/* ── Zone 1 · The big calls ─────────────────────────────────────── */}
      <Zone kicker="The big calls" kickerAccent="gold" title="Who lifts the trophy?">
        <div className="grid sm:grid-cols-2 gap-5">
          <PropCard
            icon="🏆"
            title="Champion"
            points="25 pts"
            accent="gold"
            holo
            hint="The team that wins it all."
            filled={filled.winner}
          >
            <TeamSelect
              options={teams}
              initial={initial.winner_team_id}
              disabled={locked}
              onSave={trackStr("winner", (id) => setTournamentPick({ winner_team_id: id }))}
            />
          </PropCard>
          <PropCard
            icon="🥈"
            title="Runner-up"
            points="10 pts"
            accent="blue"
            hint="Loses the Final, takes the silver."
            filled={filled.runner_up}
          >
            <TeamSelect
              options={teams}
              initial={initial.runner_up_team_id}
              disabled={locked}
              onSave={trackStr("runner_up", (id) => setTournamentPick({ runner_up_team_id: id }))}
            />
          </PropCard>
        </div>
      </Zone>

      {/* ── Zone 2 · Golden boot & mischief ────────────────────────────── */}
      <Zone
        kicker="Boots & bookings"
        kickerAccent="coral"
        title="Goals and the naughty step"
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <PropCard
            icon="👟"
            title="Golden Boot"
            points="15 pts"
            accent="gold"
            hint="Tournament top scorer."
            filled={filled.top_scorer}
          >
            <PlayerSelect
              options={players}
              initial={initial.top_scorer_player_id}
              disabled={locked}
              onSave={trackStr("top_scorer", (id) =>
                setTournamentPick({ top_scorer_player_id: id }),
              )}
            />
          </PropCard>
          <PropCard
            icon="🔢"
            title="Golden Boot tally"
            points="10 pts"
            accent="gold"
            hint="How many goals the top scorer finishes on. Closest wins, ties split."
            filled={filled.golden_boot_goals}
          >
            <NumberInput
              initial={initial.golden_boot_goals_guess}
              min={0}
              max={30}
              disabled={locked}
              onSave={trackNum("golden_boot_goals", setGoldenBootGoalsGuess)}
            />
          </PropCard>
          <PropCard
            icon="🟥"
            title="Troublemaker"
            points="15 pts"
            accent="coral"
            hint="Most card weight — yellow 1, red 2."
            filled={filled.troublemaker}
          >
            <PlayerSelect
              options={players}
              initial={propPicks["troublemaker"] ?? null}
              disabled={locked}
              onSave={trackProp("troublemaker")}
            />
          </PropCard>
        </div>
      </Zone>

      {/* ── Zone 3 · The numbers game ──────────────────────────────────── */}
      <Zone
        kicker="The numbers game"
        kickerAccent="blue"
        title="Over / unders"
        blurb="Pure guesswork. Closest guess wins each one; ties split the points."
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <PropCard
            icon="⚽"
            title="Total goals"
            points="20 pts"
            accent="blue"
            hint="Every goal, whole tournament."
            filled={filled.total_goals}
          >
            <NumberInput
              initial={initial.total_goals_guess}
              min={0}
              disabled={locked}
              onSave={trackNum("total_goals", setTotalGoalsGuess)}
            />
          </PropCard>
          <PropCard
            icon="🎆"
            title="Goal-fest match"
            points="15 pts"
            accent="blue"
            hint="Goals in the highest-scoring single match."
            filled={filled.highest_match}
          >
            <NumberInput
              initial={initial.highest_match_goals_guess}
              min={0}
              max={30}
              disabled={locked}
              onSave={trackNum("highest_match", setHighestMatchGoalsGuess)}
            />
          </PropCard>
          <PropCard
            icon="🥅"
            title="Goals in the Final"
            points="10 pts"
            accent="pitch"
            hint="Combined goals in the Final itself."
            filled={filled.final_goals}
          >
            <NumberInput
              initial={initial.final_goals_guess}
              min={0}
              max={30}
              disabled={locked}
              onSave={trackNum("final_goals", setFinalGoalsGuess)}
            />
          </PropCard>
          <PropCard
            icon="📏"
            title="Biggest win margin"
            points="10 pts"
            accent="pitch"
            hint="Largest goal margin in any single match."
            filled={filled.win_margin}
          >
            <NumberInput
              initial={initial.biggest_win_margin_guess}
              min={0}
              max={30}
              disabled={locked}
              onSave={trackNum("win_margin", setBiggestWinMarginGuess)}
            />
          </PropCard>
          <PropCard
            icon="🟥"
            title="Total red cards"
            points="15 pts"
            accent="coral"
            hint="Reds + second yellows across the tournament."
            filled={filled.red_cards}
          >
            <NumberInput
              initial={initial.total_red_cards_guess}
              min={0}
              max={200}
              disabled={locked}
              onSave={trackNum("red_cards", setTotalRedCardsGuess)}
            />
          </PropCard>
        </div>
      </Zone>

      {/* ── Zone 4 · Wildcards ─────────────────────────────────────────── */}
      <Zone kicker="Wildcards" kickerAccent="mag" title="The spicy ones">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <PropCard
            icon="🐎"
            title="Dark horse"
            points="rank pts @ QF"
            accent="mag"
            hint="Underdog points = its FIFA rank, if it reaches the quarters."
            filled={filled.dark_horse}
          >
            <TeamSelect
              options={teams}
              initial={initial.dark_horse_team_id}
              disabled={locked}
              showRanking
              onSave={trackStr("dark_horse", (id) => setTournamentPick({ dark_horse_team_id: id }))}
            />
          </PropCard>
          <PropCard
            icon="💀"
            title="First eliminated"
            points="10 pts"
            accent="mag"
            hint="First team mathematically knocked out."
            filled={filled.first_eliminated}
          >
            <TeamSelect
              options={teams}
              initial={initial.first_eliminated_team_id}
              disabled={locked}
              onSave={trackStr("first_eliminated", setFirstEliminatedPick)}
            />
          </PropCard>
          {propDefs.map((p) => (
            <PropCard
              key={p.key}
              icon="🎯"
              title={p.label}
              points="10 pts"
              accent="mag"
              hint="Who nets the opener in the Final?"
              filled={filled[`prop:${p.key}`] ?? false}
            >
              <PlayerSelect
                options={players}
                initial={propPicks[p.key] ?? null}
                disabled={locked}
                onSave={trackProp(p.key)}
              />
            </PropCard>
          ))}
        </div>
      </Zone>

      {/* ── Zone 5 · House specials (admin-resolved bar bets) ──────────────── */}
      <Zone
        kicker="House specials"
        kickerAccent="coral"
        title="The bar bets"
        blurb="The off-the-books props the data feed can't call. The commissioner settles these by hand once the tournament tells us the answer."
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <PropCard
            icon="⏱️"
            title="Neymar: 30 mins or bust"
            points="5 pts"
            accent="gold"
            hint="Will Neymar rack up 30 minutes or less of total playing time?"
            filled={filled.neymar}
          >
            <BooleanSelect
              initial={initial.neymar_minutes_pick}
              yesLabel="Yes — 30 min or less"
              noLabel="No — he plays more"
              disabled={locked}
              onSave={trackBool("neymar", setNeymarMinutesPick)}
            />
          </PropCard>
          <PropCard
            icon="🏃"
            title="Pitch invader"
            points="5 pts"
            accent="mag"
            hint="Will a streaker make it onto the field at any game?"
            filled={filled.streaker}
          >
            <BooleanSelect
              initial={initial.streaker_pick}
              yesLabel="Yes — someone runs"
              noLabel="No streaker"
              disabled={locked}
              onSave={trackBool("streaker", setStreakerPick)}
            />
          </PropCard>
          <PropCard
            icon="🧤"
            title="Clean-sheet king"
            points="5 pts"
            accent="blue"
            hint="The goalkeeper who keeps the most clean sheets."
            filled={filled.best_gk}
          >
            <PlayerSelect
              options={players}
              initial={initial.best_goalkeeper_player_id}
              disabled={locked}
              onSave={trackStr("best_gk", setBestGoalkeeperPick)}
            />
          </PropCard>
          <PropCard
            icon="⚽"
            title="Top-scoring nation"
            points="5 pts"
            accent="gold"
            hint="Golden Boot, team edition — which country bangs in the most goals."
            filled={filled.golden_boot_team}
          >
            <TeamSelect
              options={teams}
              initial={initial.golden_boot_team_id}
              disabled={locked}
              onSave={trackStr("golden_boot_team", setGoldenBootTeamPick)}
            />
          </PropCard>
          <PropCard
            icon="🙃"
            title="Poopy boot (own goals)"
            points="5 pts"
            accent="coral"
            hint="How many own goals across the whole tournament? Closest wins, ties split."
            filled={filled.own_goals}
          >
            <NumberInput
              initial={initial.own_goals_guess}
              min={0}
              max={50}
              disabled={locked}
              onSave={trackNum("own_goals", setOwnGoalsGuess)}
            />
          </PropCard>
          <PropCard
            icon="🟨"
            title="The war game"
            points="5 pts"
            accent="coral"
            hint="Which group game collects the most cards (yellows + reds)?"
            filled={filled.war_game}
          >
            <MatchSelect
              options={groupMatches}
              initial={initial.war_game_match_id}
              disabled={locked}
              onSave={trackStr("war_game", setWarGamePick)}
            />
          </PropCard>
          <PropCard
            icon="🇸🇪"
            title="Blågult minutes"
            points="5 pts"
            accent="blue"
            hint="How many different Swedish players get any playing time? Closest wins, ties split."
            filled={filled.swedish_players}
          >
            <NumberInput
              initial={initial.swedish_players_guess}
              min={0}
              max={50}
              disabled={locked}
              onSave={trackNum("swedish_players", setSwedishPlayersGuess)}
            />
          </PropCard>
        </div>
      </Zone>

      {/* ── Zone 6 · Internal league bets ──────────────────────────────── */}
      <Zone
        kicker="Internal league bets"
        kickerAccent="mag"
        title="Crown & wooden spoon"
        blurb="Per-league side bets, settled when the group stage ends — call who tops the table and who props it up. Vote tallies stay hidden until the first kickoff."
      >
        {leagueBets.length === 0 ? (
          <div className="card text-sm text-ink-soft">
            You&apos;re not in a league yet — join or create one to play the internal bets.
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {leagueBets.map((lb) => (
              <LeagueBetsCard
                key={lb.leagueId}
                leagueId={lb.leagueId}
                leagueName={lb.leagueName}
                members={lb.members}
                selfId={lb.selfId}
                initial={lb.initial}
                tallies={lb.tallies}
                locked={locked}
              />
            ))}
          </div>
        )}
      </Zone>
    </div>
  );
}

function Zone({
  kicker,
  kickerAccent,
  title,
  blurb,
  children,
}: {
  kicker: string;
  kickerAccent: Accent;
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  const badgeClass =
    kickerAccent === "gold"
      ? "badge-gold"
      : kickerAccent === "coral"
        ? "badge-coral"
        : kickerAccent === "pitch"
          ? "badge-pitch"
          : kickerAccent === "blue"
            ? "badge-ink"
            : "badge-red";
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span
          className={`badge ${badgeClass} self-start -rotate-1`}
          style={{ boxShadow: "2px 2px 0 var(--ink)" }}
        >
          {kicker}
        </span>
        <h2 className="font-display uppercase tracking-tight text-2xl leading-none">{title}</h2>
        {blurb ? <p className="text-sm text-ink-soft">{blurb}</p> : null}
      </div>
      {children}
    </section>
  );
}

function PropCard({
  icon,
  title,
  points,
  hint,
  accent = "ink",
  holo = false,
  filled,
  children,
}: {
  icon: string;
  title: string;
  points: string;
  hint?: string;
  accent?: Accent;
  holo?: boolean;
  filled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`card flex flex-col gap-3 ${holo ? "holo" : ""}`}
      style={{ boxShadow: ACCENT_SHADOW[accent] }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-2xl leading-none" aria-hidden>
            {icon}
          </span>
          <h3 className="font-display uppercase tracking-wide text-sm leading-tight">{title}</h3>
        </div>
        <span className="badge badge-ink shrink-0 whitespace-nowrap">{points}</span>
      </div>
      {hint ? <p className="text-xs text-ink-soft leading-snug">{hint}</p> : null}
      <div className="mt-auto">{children}</div>
      <span
        className={`font-mono-sticker text-[0.6rem] uppercase tracking-[0.18em] ${
          filled ? "text-pitch" : "text-ink-soft"
        }`}
      >
        {filled ? "✓ Locked in" : "— open"}
      </span>
    </div>
  );
}
