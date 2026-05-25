"use client";

import { useState, useTransition } from "react";
import { postBanterReply } from "@/lib/banter/actions";
import type { BanterReply } from "@/lib/supabase/types";

const MAX = 180;

interface Props {
  messageId: string;
  currentUserId: string;
  onOptimistic: (temp: BanterReply) => void;
  onResolved: (
    tempId: string,
    result: { ok: true; id: string } | { ok: false; error: string },
  ) => void;
}

export function BanterReplyComposer({ messageId, currentUserId, onOptimistic, onResolved }: Props) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const trimmed = body.trim();
  const over = body.length > MAX;
  const disabled = pending || trimmed.length === 0 || over;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const temp: BanterReply = {
      id: `temp-${crypto.randomUUID()}`,
      message_id: messageId,
      user_id: currentUserId,
      body: trimmed,
      created_at: new Date().toISOString(),
    };
    onOptimistic(temp);
    setBody("");
    setError(null);
    startTransition(async () => {
      const result = await postBanterReply(messageId, temp.body);
      onResolved(temp.id, result);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="mt-2">
      <form
        onSubmit={submit}
        className="flex items-center gap-1.5 rounded-full border-2 border-ink bg-paper-2 pl-3 pr-1 py-1"
      >
        <span className="font-display text-[11px] text-ink-soft" aria-hidden>↳</span>
        <input
          type="text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="reply…"
          className="flex-1 min-w-0 bg-transparent outline-none text-xs text-ink placeholder:text-ink-soft py-1"
          disabled={pending}
        />
        <span
          className={`font-mono-sticker text-[10px] font-bold ${over ? "text-coral" : "text-ink-soft"}`}
        >
          {body.length}/{MAX}
        </span>
        <button
          type="submit"
          disabled={disabled}
          className="rounded-full border-2 border-ink bg-ink text-gold px-3 py-1 font-display text-[10px] uppercase tracking-wider disabled:bg-paper-2 disabled:text-ink-soft disabled:cursor-not-allowed"
        >
          {pending ? "…" : "Send"}
        </button>
      </form>
      {error && (
        <p className="mt-1 text-[11px] text-red font-medium" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
