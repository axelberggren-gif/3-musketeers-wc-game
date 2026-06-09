"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeLeagueMember } from "@/lib/leagues/actions";

export function RemoveMemberButton({
  leagueId,
  leagueSlug,
  userId,
  memberName,
}: {
  leagueId: string;
  leagueSlug: string;
  userId: string;
  memberName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeLeagueMember(leagueId, userId, leagueSlug);
      if (!result.ok) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      // Re-render the server list so the removed row disappears immediately.
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className="btn btn-ghost btn-sm text-red shrink-0"
        aria-label={`Remove ${memberName} from the league`}
      >
        Remove
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 shrink-0">
      {error && <span className="text-xs text-red font-medium mr-1">{error}</span>}
      <span className="font-mono-sticker text-[11px] text-ink-soft hidden sm:inline">Remove?</span>
      <button onClick={handleRemove} disabled={pending} className="btn btn-ghost btn-sm text-red">
        {pending ? "Removing…" : "Remove"}
      </button>
      <button
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="btn btn-ghost btn-sm"
      >
        Cancel
      </button>
    </div>
  );
}
