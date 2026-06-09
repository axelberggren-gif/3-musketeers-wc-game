import type { ComparisonStat, PickPersonality as PickPersonalityData } from "@/lib/stats/personality";

// Read-only, no interactivity → a plain server component (no "use client"). All bars are
// hand-rolled divs using globals.css tokens; no chart library.

export function PickPersonality({ data }: { data: PickPersonalityData }) {
  const who = data.isSelf ? "Your" : "Their";
  return (
    <section className="card flex flex-col gap-5" style={{ boxShadow: "4px 4px 0 var(--coral)" }}>
      <div className="flex flex-col gap-1">
        <span
          className="badge badge-gold self-start !text-[10px]"
          style={{ boxShadow: "2px 2px 0 var(--ink)" }}
        >
          Pick personality
        </span>
        <p className="font-mono-sticker text-[10px] uppercase tracking-widest text-ink-soft">
          {who.toLowerCase()} betting fingerprint
        </p>
      </div>

      <PickMixBar mix={data.pickMix} who={who} />

      <div className="flex flex-col gap-3">
        <ComparisonRow label="Group accuracy" stat={data.groupAccuracy} kind="acc" />
        <ComparisonRow label="Knockout accuracy" stat={data.knockoutAccuracy} kind="acc" />
        <ComparisonRow label="Bracket survival" stat={data.bracketSurvival} kind="survival" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile
          value={data.boldnessPct === null ? "—" : `${data.boldnessPct}%`}
          label="Boldness"
          hint="low-consensus picks"
        />
        <Tile value={formatLead(data.avgPickLeadDays, data.avgPickLeadHours)} label="Avg pick time" hint="before kickoff" />
        <Tile value={data.upsetsCalled ?? "—"} label="Upsets called" hint="giant-killings" />
      </div>
    </section>
  );
}

function PickMixBar({
  mix,
  who,
}: {
  mix: PickPersonalityData["pickMix"];
  who: string;
}) {
  const { pct } = mix;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-sm uppercase tracking-wide">{who} pick mix</span>
        <span className="font-mono-sticker text-[10px] text-ink-soft">1X2 split</span>
      </div>
      {pct === null ? (
        <div className="h-8 rounded-lg border-2 border-ink bg-paper-2 flex items-center justify-center">
          <span className="font-mono-sticker text-[11px] text-ink-soft">No picks yet</span>
        </div>
      ) : (
        <div
          className="h-8 rounded-lg border-2 border-ink overflow-hidden flex"
          role="img"
          aria-label={`Pick mix: home ${pct.home}%, draw ${pct.draw}%, away ${pct.away}%`}
        >
          <Segment width={pct.home} className="bg-pitch text-white" />
          <Segment width={pct.draw} className="bg-gold text-ink" />
          <Segment width={pct.away} className="bg-coral text-white" />
        </div>
      )}
      <div className="font-mono-sticker text-[10px] text-ink-soft flex gap-3">
        <span>H {mix.home}</span>
        <span>D {mix.draw}</span>
        <span>A {mix.away}</span>
      </div>
    </div>
  );
}

function Segment({ width, className }: { width: number; className: string }) {
  if (width <= 0) return null;
  return (
    <div
      className={`h-full flex items-center justify-center font-display text-xs ${className}`}
      style={{ width: `${width}%` }}
    >
      {width >= 12 ? `${width}%` : ""}
    </div>
  );
}

function ComparisonRow({
  label,
  stat,
  kind,
}: {
  label: string;
  stat: ComparisonStat;
  kind: "acc" | "survival";
}) {
  const userPct = stat.userValue === null ? null : Math.round(stat.userValue * 100);
  const cohortPct = stat.cohortAvg === null ? null : Math.round(stat.cohortAvg * 100);
  const empty = userPct === null && cohortPct === null;

  const hint =
    kind === "acc"
      ? stat.userSample > 0
        ? `${stat.userCorrect}/${stat.userSample}`
        : null
      : stat.userSample > 0
        ? `played ${stat.userSample} KO`
        : null;

  const ariaLabel = `${label}: ${userPct === null ? "no data" : `${userPct}%`}${
    cohortPct === null ? "" : `, league average ${cohortPct}%`
  }`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-sm uppercase tracking-wide truncate">{label}</span>
        <span className="font-mono-sticker text-xs whitespace-nowrap">
          {userPct === null ? "—" : `${userPct}%`}
          {hint && <span className="text-ink-soft"> · {hint}</span>}
        </span>
      </div>
      {empty ? (
        <div className="h-6 rounded-md border-2 border-ink bg-paper-2 flex items-center px-2">
          <span className="font-mono-sticker text-[10px] text-ink-soft">Not enough data yet</span>
        </div>
      ) : (
        <div
          className="relative h-6 rounded-md border-2 border-ink overflow-hidden bg-white"
          role="img"
          aria-label={ariaLabel}
        >
          {cohortPct !== null && (
            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: `${cohortPct}%`,
                backgroundColor: "var(--paper-2)",
                backgroundImage:
                  "repeating-linear-gradient(45deg, var(--ink-soft) 0 2px, transparent 2px 7px)",
              }}
            />
          )}
          {userPct !== null && userPct > 0 && (
            <div
              className="absolute inset-y-0 left-0 z-10"
              style={{
                width: `${userPct}%`,
                backgroundColor: kind === "survival" ? "var(--mag)" : "var(--pitch)",
                borderRight: "2px solid var(--ink)",
              }}
            />
          )}
        </div>
      )}
      {cohortPct !== null && (
        <span className="font-mono-sticker text-[10px] text-ink-soft">league avg {cohortPct}%</span>
      )}
    </div>
  );
}

function Tile({
  value,
  label,
  hint,
}: {
  value: string | number;
  label: string;
  hint: string;
}) {
  return (
    <div
      className="rounded-xl border-2 border-ink p-3 flex flex-col gap-1 bg-white"
      style={{ boxShadow: "3px 3px 0 var(--ink)" }}
    >
      <p className="font-mono-sticker text-[10px] uppercase tracking-widest font-medium opacity-80">
        {label}
      </p>
      <p className="font-display text-2xl tabular-nums leading-none">{value}</p>
      <p className="font-mono-sticker text-[10px] text-ink-soft">{hint}</p>
    </div>
  );
}

function formatLead(days: number | null, hours: number | null): string {
  if (days === null || hours === null) return "—";
  return days >= 2 ? `${Math.round(days)}d` : `${Math.round(hours)}h`;
}
