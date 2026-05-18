"use client";

import { useState, useTransition } from "react";
import { createInvite, revokeInvite } from "@/lib/leagues/actions";
import { Copy, Plus, X } from "lucide-react";

interface Invite {
  id: string;
  token: string;
  uses_count: number;
  max_uses: number | null;
  revoked: boolean;
  expires_at: string | null;
  created_at: string;
}

export function InviteControls({
  leagueId,
  leagueSlug,
  invites,
}: {
  leagueId: string;
  leagueSlug: string;
  invites: Invite[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createInvite(leagueId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Invite links</h2>
        <button onClick={handleCreate} disabled={pending} className="btn btn-primary">
          <Plus className="w-4 h-4" /> {pending ? "Creating…" : "New invite"}
        </button>
      </div>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      {invites.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No invites yet. Create one to share.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {invites.map((invite) => (
            <InviteRow key={invite.id} invite={invite} leagueSlug={leagueSlug} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InviteRow({ invite, leagueSlug }: { invite: Invite; leagueSlug: string }) {
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/join/${invite.token}`
      : `/join/${invite.token}`;

  const expired = invite.expires_at && new Date(invite.expires_at) < new Date();
  const exhausted = invite.max_uses && invite.uses_count >= invite.max_uses;
  const dead = invite.revoked || expired || exhausted;

  async function handleCopy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleRevoke() {
    startTransition(async () => {
      await revokeInvite(invite.id, leagueSlug);
    });
  }

  return (
    <li
      className={[
        "flex items-center gap-2 p-3 rounded-lg border",
        dead ? "border-[var(--border)] opacity-60" : "border-[var(--border)]",
      ].join(" ")}
    >
      <code className="text-xs font-mono flex-1 truncate">{url}</code>
      <span className="text-xs text-[var(--muted)] tabular-nums">
        {invite.uses_count}/{invite.max_uses ?? "∞"}
      </span>
      {!dead && (
        <button onClick={handleCopy} className="btn btn-ghost px-2">
          <Copy className="w-3.5 h-3.5" /> {copied ? "Copied" : "Copy"}
        </button>
      )}
      {!dead && (
        <button
          onClick={handleRevoke}
          disabled={pending}
          className="btn btn-ghost px-2 text-[var(--danger)]"
        >
          <X className="w-3.5 h-3.5" /> Revoke
        </button>
      )}
      {invite.revoked && <span className="badge">Revoked</span>}
      {expired && <span className="badge">Expired</span>}
      {exhausted && <span className="badge">Used up</span>}
    </li>
  );
}
