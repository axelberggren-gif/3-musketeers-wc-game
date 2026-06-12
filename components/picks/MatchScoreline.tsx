import Link from "next/link";
import { CountryFlag } from "@/components/CountryFlag";
import type { GroupPickMatch } from "@/lib/stats/group-picks";

/**
 * Compact flags + codes + score (or "vs") block for one group match, linking to
 * `/match/[id]`. Hook-free; shared by the profile picks board and `/compare`.
 */
export function MatchScoreline({ match }: { match: GroupPickMatch }) {
  const finished = match.status === "FINISHED";
  const live = match.status === "LIVE";
  return (
    <Link
      href={`/match/${match.id}`}
      className="inline-flex items-center gap-1.5 min-w-0 hover:text-coral"
    >
      <CountryFlag
        crestUrl={match.home?.crest_url}
        code={match.home?.code}
        name={match.home?.name ?? "TBD"}
        size={18}
      />
      <span className="font-display uppercase text-xs tracking-wide">
        {match.home?.code ?? "TBD"}
      </span>
      <span
        className={`font-mono-sticker text-[11px] tabular-nums text-center min-w-8 ${
          live ? "text-coral font-bold" : "text-ink-soft"
        }`}
      >
        {finished || live ? `${match.home_score ?? "–"}–${match.away_score ?? "–"}` : "vs"}
      </span>
      <span className="font-display uppercase text-xs tracking-wide">
        {match.away?.code ?? "TBD"}
      </span>
      <CountryFlag
        crestUrl={match.away?.crest_url}
        code={match.away?.code}
        name={match.away?.name ?? "TBD"}
        size={18}
      />
    </Link>
  );
}
