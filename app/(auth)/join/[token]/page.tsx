import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { consumeInviteForUser, setPendingInvite, validateInviteToken } from "@/lib/auth/invite";
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
      <main className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="card max-w-md flex flex-col gap-3">
          <h1 className="text-xl font-bold">Invite invalid</h1>
          <p className="text-sm text-[var(--muted)]">
            This invite link has expired, been revoked, or doesn&rsquo;t exist.
          </p>
          <Link href="/" className="btn btn-secondary self-start">
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

  if (user) {
    const result = await consumeInviteForUser(token, user.id);
    if (result.ok) redirect(`/leagues/${result.league_slug}`);
  }

  await setPendingInvite(token);

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-20">
      <div className="card w-full max-w-md flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <span className="badge w-fit">Invite</span>
          <h1 className="text-2xl font-bold">Join {invite.league_name}</h1>
          <p className="text-sm text-[var(--muted)]">
            You&rsquo;ve been invited to a private league. Sign in to join.
          </p>
        </div>
        <LoginForm
          inviteToken={token}
          devInstant={process.env.DEV_INSTANT_LOGIN === "true"}
        />
      </div>
    </main>
  );
}
