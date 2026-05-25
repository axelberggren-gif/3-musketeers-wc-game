"use client";

import { useTransition } from "react";
import type { BanterMessage as BanterMessageRow, BanterReply } from "@/lib/supabase/types";
import { BanterReplyComposer } from "./BanterReplyComposer";

export type ProfileLite = { username: string; display_name: string | null };

interface Props {
  message: BanterMessageRow;
  replies: BanterReply[];
  expanded: boolean;
  currentUserId: string;
  profilesById: Record<string, ProfileLite>;
  onToggleThread: (messageId: string) => void;
  onDeleteMessage: (messageId: string) => void | Promise<void>;
  onReplyOptimistic: (reply: BanterReply) => void;
  onReplyResolved: (
    tempId: string,
    result: { ok: true; id: string } | { ok: false; error: string },
  ) => void;
  onDeleteReply: (messageId: string, replyId: string) => void | Promise<void>;
}

export function BanterMessage({
  message,
  replies,
  expanded,
  currentUserId,
  profilesById,
  onToggleThread,
  onDeleteMessage,
  onReplyOptimistic,
  onReplyResolved,
  onDeleteReply,
}: Props) {
  const [pendingDelete, startDeleteTransition] = useTransition();
  const author = profilesById[message.user_id];
  const authorHandle = author?.username ?? "unknown";
  const authorDisplay = author?.display_name ?? author?.username ?? "unknown";
  const isAuthor = message.user_id === currentUserId;
  const replyCount = replies.length;
  const isOptimistic = message.id.startsWith("temp-");

  function handleDelete() {
    if (pendingDelete || isOptimistic) return;
    startDeleteTransition(async () => {
      await onDeleteMessage(message.id);
    });
  }

  return (
    <div
      className="rounded-xl border-2 border-ink bg-white p-2.5 sm:p-3"
      style={{ boxShadow: "2px 2px 0 var(--ink)" }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-display text-xs uppercase tracking-wide truncate">
          {authorDisplay}
        </span>
        <span className="font-mono-sticker text-[10px] text-ink-soft truncate">@{authorHandle}</span>
        <span className="font-mono-sticker text-[10px] text-ink-soft ml-auto whitespace-nowrap">
          {formatRelative(message.created_at)}
        </span>
        {isAuthor && !isOptimistic && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pendingDelete}
            className="font-mono-sticker text-[10px] uppercase tracking-widest text-ink-soft hover:text-red disabled:opacity-50"
            aria-label="Delete message"
          >
            {pendingDelete ? "…" : "✕"}
          </button>
        )}
      </div>
      <div className="text-[13px] leading-snug text-ink font-medium whitespace-pre-wrap break-words">
        {message.body}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onToggleThread(message.id)}
          disabled={isOptimistic}
          className="font-mono-sticker text-[10px] uppercase tracking-widest text-ink-soft hover:text-ink disabled:opacity-40"
        >
          {replyCount > 0
            ? `${replyCount} ${replyCount === 1 ? "reply" : "replies"} ${expanded ? "▾" : "▸"}`
            : expanded
              ? "Close ▾"
              : "↳ Reply"}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-dashed border-ink pl-2.5 border-l-2">
          {replies.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {replies.map((r) => (
                <ReplyRow
                  key={r.id}
                  reply={r}
                  currentUserId={currentUserId}
                  profilesById={profilesById}
                  onDelete={() => onDeleteReply(message.id, r.id)}
                />
              ))}
            </ul>
          )}
          {!isOptimistic && (
            <BanterReplyComposer
              messageId={message.id}
              currentUserId={currentUserId}
              onOptimistic={onReplyOptimistic}
              onResolved={onReplyResolved}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ReplyRow({
  reply,
  currentUserId,
  profilesById,
  onDelete,
}: {
  reply: BanterReply;
  currentUserId: string;
  profilesById: Record<string, ProfileLite>;
  onDelete: () => void | Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const author = profilesById[reply.user_id];
  const handle = author?.username ?? "unknown";
  const isAuthor = reply.user_id === currentUserId;
  const isOptimistic = reply.id.startsWith("temp-");

  function handleDelete() {
    if (pending || isOptimistic) return;
    startTransition(async () => {
      await onDelete();
    });
  }

  return (
    <li className="rounded-lg border-2 border-ink bg-paper-2 px-2.5 py-1.5">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="font-mono-sticker text-[10px] font-bold">@{handle}</span>
        <span className="font-mono-sticker text-[9px] text-ink-soft ml-auto">
          {formatRelative(reply.created_at)}
        </span>
        {isAuthor && !isOptimistic && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="font-mono-sticker text-[10px] text-ink-soft hover:text-red disabled:opacity-50"
            aria-label="Delete reply"
          >
            {pending ? "…" : "✕"}
          </button>
        )}
      </div>
      <div className="text-xs leading-snug text-ink font-medium whitespace-pre-wrap break-words">
        {reply.body}
      </div>
    </li>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}
