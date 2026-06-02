import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { consumeInviteForUser, validateInviteToken } from "@/lib/auth/invite";
import { LoginForm } from "../../login/LoginForm";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await validateInviteToken(token);

  if (!invite) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-20">
        <div className="card max-w-md flex flex-col gap-3">
          <span
            className="badge badge-red self-start"
            style={{ boxShadow: "3px 3px 0 var(--ink)" }}
          >
            ✕ Invite invalid
          </span>
          <h1 className="font-display uppercase text-2xl">Link no good</h1>
          <p className="text-sm text-ink-soft">
            This invite link has expired, been revoked, or doesn&rsquo;t exist.
          </p>
          <Link href="/" className="btn btn-secondary self-start mt-1">
            Back home
          </Link>
        </div>
      </main>
    );
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let joinError: string | null = null;
  if (user) {
    const result = await consumeInviteForUser(token, user.id);
    if (result.ok) redirect(`/leagues/${result.league_slug}`);
    joinError = result.error;
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-12 sm:py-20">
      <div className="w-full max-w-md flex flex-col gap-5">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 self-center bg-ink text-gold px-3 py-1.5 rounded-lg border-2 border-ink font-display text-base tracking-wider"
          style={{ boxShadow: "3px 3px 0 var(--coral)" }}
        >
          ⚽ KICKOFF<span className="text-pitch-light text-[0.65em]">&apos;26</span>
        </Link>
        <div className="card flex flex-col gap-5">
          {joinError ? (
            <span
              className="badge badge-red self-start"
              style={{ boxShadow: "3px 3px 0 var(--ink)" }}
            >
              ✕ Couldn&rsquo;t join
            </span>
          ) : (
            <span
              className="badge badge-coral self-start -rotate-2"
              style={{ boxShadow: "3px 3px 0 var(--ink)" }}
            >
              🎟 You&rsquo;ve been invited
            </span>
          )}
          <div className="flex flex-col gap-1.5">
            <h1 className="font-display uppercase text-3xl sm:text-4xl leading-none tracking-tight">
              Join {invite.league_name}
            </h1>
            <p className="text-sm text-ink-soft">
              {joinError
                ? joinError
                : "You’ve been invited to a private league. Sign in to accept and start picking."}
            </p>
          </div>
          <div
            className="rounded-lg border-2 border-ink bg-paper-2 px-3 py-2 font-mono-sticker text-xs flex items-center justify-between gap-2"
            style={{ boxShadow: "3px 3px 0 var(--ink)" }}
          >
            <span className="truncate">kickoff.app/j/{token.slice(0, 12)}</span>
            <span className="badge badge-gold !py-0 !text-[10px]">Invite</span>
          </div>
          {joinError ? (
            <div className="flex flex-col gap-2">
              <Link href="/leagues" className="btn btn-secondary self-start">
                Back to my leagues
              </Link>
              <p className="text-xs text-ink-soft">
                Ask the league owner to check whether the invite is still active.
              </p>
            </div>
          ) : (
            <LoginForm inviteToken={token} />
          )}
        </div>
      </div>
    </main>
  );
}
