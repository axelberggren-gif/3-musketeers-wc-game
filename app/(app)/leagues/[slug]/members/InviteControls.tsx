"use client";

import { useState, useTransition } from "react";
import { createInvite, revokeInvite } from "@/lib/leagues/actions";

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
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-display uppercase tracking-wide text-base">Invite links</h2>
        <button onClick={handleCreate} disabled={pending} className="btn btn-primary btn-sm">
          + {pending ? "Creating…" : "New invite"}
        </button>
      </div>
      {error && <p className="text-sm text-red font-medium">{error}</p>}
      {invites.length === 0 ? (
        <p className="text-sm text-ink-soft">No invites yet. Create one to share.</p>
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
  const [error, setError] = useState<string | null>(null);
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/join/${invite.token}`
      : `/join/${invite.token}`;

  const expired = invite.expires_at && new Date(invite.expires_at) < new Date();
  const exhausted = invite.max_uses && invite.uses_count >= invite.max_uses;
  const dead = invite.revoked || expired || exhausted;

  async function handleCopy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can reject (permissions, non-secure context, focus loss).
      setError("Couldn’t copy — select the link text and copy it manually.");
    }
  }

  function handleRevoke() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await revokeInvite(invite.id, leagueSlug);
        if (!result.ok) setError(result.error);
      } catch (e) {
        // revokeInvite throws on auth failure ("Not signed in"); a network
        // blip mid-server-action lands here too. Surface it instead of
        // failing silently.
        setError(e instanceof Error ? e.message : "Failed to revoke invite.");
      }
    });
  }

  return (
    <li
      className={[
        "flex flex-col gap-2 p-3 rounded-lg border-2 border-ink",
        dead ? "opacity-60 bg-paper-2" : "bg-paper-2",
      ].join(" ")}
      style={{ boxShadow: "2px 2px 0 var(--ink)" }}
    >
      <div className="flex items-center gap-2">
        <code className="text-xs font-mono-sticker flex-1 truncate text-ink">{url}</code>
        <span className="font-mono-sticker text-[11px] text-ink-soft tabular-nums">
          {invite.uses_count}/{invite.max_uses ?? "∞"}
        </span>
        {!dead && (
          <button onClick={handleCopy} className="btn btn-ghost btn-sm">
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        {!dead && (
          <button
            onClick={handleRevoke}
            disabled={pending}
            className="btn btn-ghost btn-sm text-red"
          >
            {pending ? "Revoking…" : "Revoke"}
          </button>
        )}
        {invite.revoked && <span className="badge !text-[10px]">Revoked</span>}
        {expired && <span className="badge !text-[10px]">Expired</span>}
        {exhausted && <span className="badge !text-[10px]">Used up</span>}
      </div>
      {error && <p className="text-xs text-red font-medium">{error}</p>}
    </li>
  );
}
