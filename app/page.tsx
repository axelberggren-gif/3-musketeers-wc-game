import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/today");

  return (
    <main className="flex-1 flex flex-col">
      <header className="px-4 sm:px-8 pt-5 pb-4 flex items-center justify-between">
        <div
          className="inline-flex items-center gap-1.5 bg-ink text-gold px-3 py-1.5 rounded-lg border-2 border-ink font-display text-base sm:text-lg tracking-wider"
          style={{ boxShadow: "3px 3px 0 var(--coral)" }}
        >
          ⚽ KICKOFF<span className="text-pitch-light text-[0.65em]">&apos;26</span>
        </div>
        <Link href="/login" className="btn btn-sm">
          Sign in
        </Link>
      </header>

      <section className="px-4 sm:px-8 pt-4 pb-10 max-w-5xl w-full mx-auto flex flex-col items-center text-center gap-5">
        <span
          className="inline-flex items-center gap-1.5 bg-gold text-ink border-2 border-ink rounded-full px-3 py-1 font-display text-[11px] tracking-widest uppercase"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          ★ World Cup &apos;26 · USA · CAN · MEX
        </span>
        <h1 className="font-display uppercase text-5xl sm:text-7xl leading-[0.95] tracking-tight">
          Predict every match.
          <br />
          <span
            className="inline-block bg-gold text-ink border-2 border-ink rounded-md px-3 py-1 mx-1 -rotate-2 align-middle"
            style={{ boxShadow: "4px 4px 0 var(--ink)" }}
          >
            BEAT
          </span>{" "}
          your friends.
        </h1>
        <p className="text-base sm:text-lg text-ink-soft max-w-xl">
          A friends-only prediction game for the 2026 World Cup. Stick your 1X2 picks, fill the
          knockout bracket, lock in tournament props — then watch the leaderboard light up.
        </p>
        <div className="flex flex-wrap gap-3 justify-center mt-2">
          <Link href="/login" className="btn btn-coral">
            ▶ Start the album
          </Link>
          <a href="#how" className="btn btn-secondary">
            How it works
          </a>
        </div>

        <StickerStack />
      </section>

      <section
        id="how"
        className="px-4 sm:px-8 pb-16 max-w-5xl w-full mx-auto grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
      >
        <FeatureCard
          glyph="🎯"
          title="Round 1 — Group stage"
          body="Pick 1X2 for all 48 group games + tournament winner, top scorer, dark horse and player props. Editable until first kickoff."
        />
        <FeatureCard
          glyph="🏆"
          title="Round 2 — Bracket"
          body="When the groups end, fill the entire R16 → Final bracket. Locks at R16 kickoff."
        />
        <FeatureCard
          glyph="👥"
          title="Private leagues"
          body="Compete in private leagues with friends, colleagues, or family. Invite via shareable link."
        />
        <FeatureCard
          glyph="⚡"
          title="Live leaderboard"
          body="Points update as matches finish. See friends' picks when the whistle blows — never before."
        />
      </section>

      <footer className="pitch-stripes mt-auto py-5 px-4 sm:px-8 border-t-2 border-ink">
        <p className="text-white font-display uppercase tracking-widest text-center text-sm sm:text-base">
          ⚽ Stick · Predict · Score ⚽
        </p>
      </footer>
    </main>
  );
}

/**
 * Decorative sticker stack: five rotated country stickers fanned out under
 * the headline. Pure decoration — uses hard-coded flag emoji + team code.
 */
function StickerStack() {
  const stickers = [
    { flag: "🇦🇷", code: "ARG", color: "var(--blue)", rot: -8, x: -12 },
    { flag: "🇧🇷", code: "BRA", color: "var(--gold)", rot: 6, x: -4 },
    { flag: "🇪🇸", code: "ESP", color: "var(--coral)", rot: -3, x: 4 },
    { flag: "🇫🇷", code: "FRA", color: "var(--blue)", rot: 9, x: 12 },
    { flag: "🇩🇪", code: "GER", color: "var(--ink)", rot: -5, x: 20 },
  ];
  return (
    <div className="relative h-44 sm:h-48 w-full max-w-md mx-auto mt-2 select-none">
      <span
        className="absolute -top-1 right-3 sm:right-10 z-10 inline-flex items-center justify-center w-20 h-20 rounded-full bg-ink text-gold border-2 border-ink font-display text-[10px] tracking-widest uppercase text-center leading-tight -rotate-12"
        style={{ boxShadow: "4px 4px 0 var(--coral)" }}
      >
        T-MINUS
        <br />
        21 DAYS
      </span>
      <div className="absolute inset-0 flex items-end justify-center gap-1 pb-4">
        {stickers.map((s, i) => (
          <div
            key={s.code}
            className="rounded-xl border-2 border-ink flex flex-col items-center justify-center w-16 h-24 sm:w-20 sm:h-28"
            style={{
              background: s.color,
              transform: `translateX(${s.x}px) rotate(${s.rot}deg)`,
              boxShadow: "4px 4px 0 var(--ink)",
              zIndex: i,
            }}
          >
            <span className="text-3xl sm:text-4xl">{s.flag}</span>
            <span
              className="font-display text-[10px] sm:text-xs tracking-wider mt-1 px-1.5 py-0.5 rounded bg-ink text-white"
            >
              {s.code}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatureCard({
  glyph,
  title,
  body,
}: {
  glyph: string;
  title: string;
  body: string;
}) {
  return (
    <div className="card flex flex-col gap-3">
      <div
        className="w-12 h-12 rounded-xl bg-gold border-2 border-ink flex items-center justify-center text-2xl"
        style={{ boxShadow: "3px 3px 0 var(--ink)" }}
      >
        {glyph}
      </div>
      <h3 className="font-display uppercase text-base tracking-wide">{title}</h3>
      <p className="text-sm text-ink-soft">{body}</p>
    </div>
  );
}
