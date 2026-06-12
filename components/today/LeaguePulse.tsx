import Link from "next/link";
import type { FormDot } from "@/lib/stats/league-pulse";

export interface PulseAgreementRow {
  username: string;
  label: string;
  /** Matches where both you and them have a visible pick. */
  both: number;
  /** …of those, same call. */
  same: number;
}

export interface PulseFormRow {
  username: string;
  label: string;
  isSelf: boolean;
  /** Last decided picks, oldest → newest. */
  dots: FormDot[];
  streak: { kind: FormDot; length: number } | null;
}

/** A streak only counts as hot/cold form once it's this long. */
const STREAK_BADGE_MIN = 2;

/**
 * The /today "League pulse" strip: look-alikes/opposites (you vs every
 * league-mate, deep-linking to /compare) and the form guide (each member's
 * recent ✓/✗ run + current streak). Hook-free server component — all math is
 * done in `lib/stats/league-pulse.ts` and arrives as plain props.
 */
export function LeaguePulse({
  agreement,
  form,
}: {
  agreement: PulseAgreementRow[];
  form: PulseFormRow[];
}) {
  const comparable = agreement.filter((r) => r.both > 0);
  const twin = comparable[0] ?? null;
  const opposite = comparable.length > 1 ? comparable[comparable.length - 1] : null;

  const hotLength = Math.max(
    0,
    ...form.map((r) => (r.streak?.kind === "correct" ? r.streak.length : 0)),
  );
  const coldLength = Math.max(
    0,
    ...form.map((r) => (r.streak?.kind === "wrong" ? r.streak.length : 0)),
  );

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display uppercase tracking-wide text-base flex items-center gap-2">
        <span aria-hidden>📊</span> League pulse
      </h2>
      <div className="grid md:grid-cols-2 gap-4 items-start">
        <div className="card flex flex-col gap-3">
          <h3 className="font-display uppercase tracking-wide text-sm">
            🪞 Twins &amp; opposites
          </h3>
          {comparable.length === 0 ? (
            <p className="text-sm text-ink-soft">
              No overlapping picks to compare yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {comparable.map((row) => (
                <li key={row.username}>
                  <Link
                    href={`/compare?b=${encodeURIComponent(row.username)}`}
                    className="flex items-center justify-between gap-2 rounded-lg border-2 border-ink bg-paper-2 px-3 py-2 hover:-translate-y-0.5 transition-transform"
                    style={{ boxShadow: "2px 2px 0 var(--ink)" }}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-display uppercase text-xs tracking-wide truncate">
                        You &amp; {row.label}
                      </span>
                      {twin?.username === row.username && (
                        <span className="badge badge-gold !text-[9px]">Your twin</span>
                      )}
                      {opposite?.username === row.username && (
                        <span className="badge badge-red !text-[9px]">Your opposite</span>
                      )}
                    </span>
                    <span className="font-mono-sticker text-[11px] tabular-nums text-ink-soft whitespace-nowrap">
                      {row.same}/{row.both} same
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="font-mono-sticker text-[10px] uppercase tracking-widest text-ink-soft">
            Tap a pair for the full head-to-head ⚔️
          </p>
        </div>

        <div className="card flex flex-col gap-3">
          <h3 className="font-display uppercase tracking-wide text-sm">🔥 Form guide</h3>
          {form.every((r) => r.dots.length === 0) ? (
            <p className="text-sm text-ink-soft">
              Form fills in as results land — check back after the first final whistle.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {form.map((row) => (
                <li
                  key={row.username}
                  className={`flex items-center justify-between gap-2 rounded-lg border-2 border-ink px-3 py-2 ${
                    row.isSelf ? "bg-gold" : "bg-paper-2"
                  }`}
                  style={{ boxShadow: "2px 2px 0 var(--ink)" }}
                >
                  <Link
                    href={`/profile/${row.username}`}
                    className="font-display uppercase text-xs tracking-wide truncate hover:text-coral"
                  >
                    {row.label}
                    {row.isSelf && <span className="text-ink-soft"> (you)</span>}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-1" aria-label="Recent picks">
                      {row.dots.length === 0 ? (
                        <span className="font-mono-sticker text-[10px] text-ink-soft">—</span>
                      ) : (
                        row.dots.map((dot, i) => (
                          <span
                            key={i}
                            className={`inline-flex w-4 h-4 items-center justify-center rounded border border-ink text-[9px] font-bold ${
                              dot === "correct"
                                ? "bg-pitch text-white"
                                : "bg-coral text-white"
                            }`}
                            aria-label={dot}
                          >
                            {dot === "correct" ? "✓" : "✗"}
                          </span>
                        ))
                      )}
                    </span>
                    {row.streak &&
                      row.streak.length >= STREAK_BADGE_MIN &&
                      (row.streak.kind === "correct"
                        ? row.streak.length === hotLength
                        : row.streak.length === coldLength) && (
                        <span
                          className="font-mono-sticker text-[11px] whitespace-nowrap"
                          title={
                            row.streak.kind === "correct"
                              ? `${row.streak.length} correct in a row`
                              : `${row.streak.length} wrong in a row`
                          }
                        >
                          {row.streak.kind === "correct" ? "🔥" : "🧊"}
                          {row.streak.length}
                        </span>
                      )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
