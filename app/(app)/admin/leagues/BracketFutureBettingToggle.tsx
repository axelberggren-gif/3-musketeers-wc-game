"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLeagueBracketFutureAccess } from "@/lib/admin/actions";

/**
 * Admin toggle for a league's bracket "future betting" access (migrations
 * 0032 + 0036): open leagues can keep betting on unplayed knockout matches
 * past the global knockout lock — played matches stay locked and only teams
 * that advanced are pickable.
 */
export function BracketFutureBettingToggle({
  leagueId,
  open,
}: {
  leagueId: string;
  open: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await setLeagueBracketFutureAccess(leagueId, !open);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Re-render the server list so the badge flips immediately.
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red font-medium">{error}</span>}
      <button
        onClick={toggle}
        disabled={pending}
        className={`badge ${open ? "badge-gold" : ""} cursor-pointer disabled:opacity-60`}
        title={
          open
            ? "Members can bet on unplayed knockout matches past the global lock. Click to close."
            : "Bracket follows the global knockout lock. Click to open future betting for this league."
        }
      >
        {pending ? "Saving…" : open ? "🔮 Future betting ON" : "Future betting off"}
      </button>
    </div>
  );
}
