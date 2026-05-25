"use client";

import { useRef, useState, useTransition } from "react";
import { postBanter } from "@/lib/banter/actions";
import type { BanterMessage } from "@/lib/supabase/types";

const MAX = 180;
const EMOJI = ["🔥", "😭", "💀", "🤡"] as const;

interface Props {
  leagueId: string;
  currentUserId: string;
  onOptimistic: (temp: BanterMessage) => void;
  onResolved: (
    tempId: string,
    result: { ok: true; id: string } | { ok: false; error: string },
  ) => void;
}

export function BanterComposer({ leagueId, currentUserId, onOptimistic, onResolved }: Props) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = body.trim();
  const over = body.length > MAX;
  const disabled = pending || trimmed.length === 0 || over;

  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + emoji + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      const el2 = textareaRef.current;
      if (!el2) return;
      el2.focus();
      const pos = start + emoji.length;
      el2.setSelectionRange(pos, pos);
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const temp: BanterMessage = {
      id: `temp-${crypto.randomUUID()}`,
      league_id: leagueId,
      user_id: currentUserId,
      body: trimmed,
      created_at: new Date().toISOString(),
    };
    onOptimistic(temp);
    setBody("");
    setError(null);
    startTransition(async () => {
      const result = await postBanter(leagueId, temp.body);
      onResolved(temp.id, result);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border-2 border-ink bg-paper p-2.5 sm:p-3"
      style={{ boxShadow: "2px 2px 0 var(--ink)" }}
    >
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Talk your shit…"
        rows={2}
        disabled={pending}
        className="w-full bg-transparent outline-none text-sm text-ink placeholder:text-ink-soft resize-none leading-snug font-medium"
      />
      <div className="mt-2 pt-2 border-t border-dashed border-ink flex items-center gap-1.5 flex-wrap">
        {EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            onMouseDown={(ev) => {
              ev.preventDefault();
              insertEmoji(e);
            }}
            disabled={pending}
            className="w-7 h-7 rounded-md border-2 border-ink bg-paper-2 text-sm leading-none flex items-center justify-center disabled:opacity-50"
            aria-label={`Insert ${e}`}
          >
            {e}
          </button>
        ))}
        <span
          className={`ml-auto font-mono-sticker text-[10px] font-bold ${over ? "text-coral" : "text-ink-soft"}`}
        >
          {body.length}/{MAX}
        </span>
        <button
          type="submit"
          disabled={disabled}
          className="rounded-full border-2 border-ink bg-ink text-gold px-3.5 py-1 font-display text-[11px] uppercase tracking-wider disabled:bg-paper-2 disabled:text-ink-soft disabled:cursor-not-allowed"
          style={{ boxShadow: disabled ? "none" : "2px 2px 0 var(--coral)" }}
        >
          {pending ? "Posting…" : "Post"}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-red font-medium" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
