// Read-only "Predicted advancers" view for `/predict`. Renders the 32 teams
// the user's group-stage 1X2 picks imply will advance to the knockouts:
// 12 group winners + 12 runners-up + 8 best 3rd-place teams.
//
// Pure presentational server component. All derivation lives in
// `lib/predictions/advancers.ts` — this file only formats the result.
//
// Refreshes on full page re-render (Next.js Server Component). When the user
// flips a 1X2 pick via `MatchPickCard`, the parent route's revalidation
// re-runs the server query and re-derives this view.

import type { AdvancersResult, TeamStanding } from "@/lib/predictions/advancers";

interface Props {
  advancers: AdvancersResult;
  /** team_id → display name/code, for rendering. */
  teamNamesById: Map<string, { name: string; code: string | null }>;
}

function teamLabel(
  teamId: string,
  teamNamesById: Map<string, { name: string; code: string | null }>,
): string {
  const t = teamNamesById.get(teamId);
  if (!t) return "?";
  return t.code ? `${t.code} — ${t.name}` : t.name;
}

function TiebreakerBadge({ kind }: { kind: TeamStanding["tiebreaker"] }) {
  if (!kind || kind === null) return null;
  if (kind === "head_to_head") {
    return (
      <span className="font-mono-sticker text-[9px] uppercase tracking-wider text-ink-soft">
        H2H
      </span>
    );
  }
  if (kind === "fifa_ranking") {
    return (
      <span className="font-mono-sticker text-[9px] uppercase tracking-wider text-coral">
        FIFA
      </span>
    );
  }
  return (
    <span className="font-mono-sticker text-[9px] uppercase tracking-wider text-coral">
      Tied
    </span>
  );
}

export function PredictedAdvancers({ advancers, teamNamesById }: Props) {
  if (advancers.winners.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
        Make your 1X2 picks below — once you pick a match, the teams you think will
        advance will surface here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Group winners + runners-up: one card per group, 1st & 2nd shown. */}
      <div className="flex flex-col gap-2">
        <h3 className="font-mono-sticker text-[11px] uppercase tracking-widest text-ink-soft font-medium">
          Group winners &amp; runners-up
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {advancers.winners.map((w, i) => {
            const r = advancers.runnersUp[i];
            return (
              <div
                key={w.group_letter}
                className="rounded-xl border-2 border-ink bg-white p-3 flex flex-col gap-1"
                style={{ boxShadow: "3px 3px 0 var(--ink)" }}
              >
                <div className="font-display uppercase text-[11px] tracking-wider text-ink-soft">
                  Group {w.group_letter}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    <span className="font-mono-sticker text-[10px] text-ink-soft mr-1">1.</span>
                    {teamLabel(w.team_id, teamNamesById)}
                  </span>
                  <TiebreakerBadge kind={w.tiebreaker} />
                </div>
                {r ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">
                      <span className="font-mono-sticker text-[10px] text-ink-soft mr-1">2.</span>
                      {teamLabel(r.team_id, teamNamesById)}
                    </span>
                    <TiebreakerBadge kind={r.tiebreaker} />
                  </div>
                ) : (
                  <div className="text-sm text-ink-soft italic">2. —</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Best 3rd-place teams (up to 8). */}
      <div className="flex flex-col gap-2">
        <h3 className="font-mono-sticker text-[11px] uppercase tracking-widest text-ink-soft font-medium">
          Best 3rd-place teams ({advancers.bestThirds.length}/8)
        </h3>
        {advancers.bestThirds.length === 0 ? (
          <p className="text-sm text-ink-soft italic">
            Pick more matches to see 3rd-place contenders.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {advancers.bestThirds.map((t) => (
              <div
                key={t.team_id}
                className="rounded-lg border-2 border-ink bg-paper-2 px-3 py-2 flex items-center justify-between gap-2"
                style={{ boxShadow: "2px 2px 0 var(--ink)" }}
              >
                <span className="text-sm">
                  <span className="font-mono-sticker text-[10px] text-ink-soft mr-1">
                    {t.group_letter}
                  </span>
                  {teamLabel(t.team_id, teamNamesById)}
                </span>
                <TiebreakerBadge kind={t.tiebreaker} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tiebreaker explainer — only render when there's something to explain. */}
      {advancers.warnings.length > 0 && (
        <div className="rounded-lg border-2 border-coral bg-white p-3 flex flex-col gap-1">
          <div className="font-display uppercase text-[11px] tracking-wider text-coral">
            Tiebreaker notes
          </div>
          <ul className="text-xs text-ink-soft flex flex-col gap-1 list-disc pl-5">
            {advancers.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
