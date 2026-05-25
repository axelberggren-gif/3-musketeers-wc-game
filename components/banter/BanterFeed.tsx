"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { deleteBanterMessage, deleteBanterReply } from "@/lib/banter/actions";
import type { BanterMessage, BanterReply } from "@/lib/supabase/types";
import { BanterComposer } from "./BanterComposer";
import { BanterMessage as BanterMessageCard, type ProfileLite } from "./BanterMessage";

interface Props {
  leagueId: string;
  currentUserId: string;
  initialMessages: BanterMessage[];
  initialReplies: Record<string, BanterReply[]>;
  profilesById: Record<string, ProfileLite>;
}

type PostResult = { ok: true; id: string } | { ok: false; error: string };

export function BanterFeed({
  leagueId,
  currentUserId,
  initialMessages,
  initialReplies,
  profilesById,
}: Props) {
  // Messages held in ascending order; sorted descending for render.
  const [messages, setMessages] = useState<BanterMessage[]>(initialMessages);
  const [replies, setReplies] = useState<Record<string, BanterReply[]>>(initialReplies);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(() => new Set());
  const [topError, setTopError] = useState<string | null>(null);

  // Refs let realtime handlers see the latest state without re-subscribing.
  const messagesRef = useRef(messages);
  const repliesRef = useRef(replies);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    repliesRef.current = replies;
  }, [replies]);

  // ── Composer / reply: optimistic + reconcile ─────────────────────────
  const addMessage = useCallback((m: BanterMessage) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }, []);

  const reconcileMessage = useCallback((tempId: string, result: PostResult) => {
    if (result.ok) {
      setMessages((prev) => {
        const realAlreadyPresent = prev.some((m) => m.id === result.id);
        if (realAlreadyPresent) {
          return prev.filter((m) => m.id !== tempId);
        }
        return prev.map((m) => (m.id === tempId ? { ...m, id: result.id } : m));
      });
    } else {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setTopError(result.error);
    }
  }, []);

  const addReply = useCallback((reply: BanterReply) => {
    setReplies((prev) => {
      const list = prev[reply.message_id] ?? [];
      if (list.some((r) => r.id === reply.id)) return prev;
      return { ...prev, [reply.message_id]: [...list, reply] };
    });
    setExpandedThreads((prev) => {
      if (prev.has(reply.message_id)) return prev;
      const next = new Set(prev);
      next.add(reply.message_id);
      return next;
    });
  }, []);

  const reconcileReply = useCallback((tempId: string, result: PostResult) => {
    if (result.ok) {
      setReplies((prev) => {
        const out: Record<string, BanterReply[]> = {};
        for (const [mid, list] of Object.entries(prev)) {
          const realAlreadyPresent = list.some((r) => r.id === result.id);
          out[mid] = realAlreadyPresent
            ? list.filter((r) => r.id !== tempId)
            : list.map((r) => (r.id === tempId ? { ...r, id: result.id } : r));
        }
        return out;
      });
    } else {
      setReplies((prev) => {
        const out: Record<string, BanterReply[]> = {};
        for (const [mid, list] of Object.entries(prev)) {
          out[mid] = list.filter((r) => r.id !== tempId);
        }
        return out;
      });
      setTopError(result.error);
    }
  }, []);

  const toggleThread = useCallback((messageId: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  // ── Delete: snapshot for rollback ────────────────────────────────────
  const requestDeleteMessage = useCallback(async (messageId: string) => {
    const prevMessage = messagesRef.current.find((m) => m.id === messageId);
    const prevReplies = repliesRef.current[messageId];
    if (!prevMessage) return;
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    setReplies((prev) => {
      const { [messageId]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
    const result = await deleteBanterMessage(messageId);
    if (!result.ok) {
      setMessages((prev) =>
        prev.some((m) => m.id === messageId)
          ? prev
          : [...prev, prevMessage].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      );
      if (prevReplies) {
        setReplies((prev) => ({ ...prev, [messageId]: prevReplies }));
      }
      setTopError(result.error);
    }
  }, []);

  const requestDeleteReply = useCallback(async (messageId: string, replyId: string) => {
    const list = repliesRef.current[messageId] ?? [];
    const prev = list.find((r) => r.id === replyId);
    if (!prev) return;
    setReplies((prevState) => ({
      ...prevState,
      [messageId]: (prevState[messageId] ?? []).filter((r) => r.id !== replyId),
    }));
    const result = await deleteBanterReply(replyId);
    if (!result.ok) {
      setReplies((prevState) => {
        const cur = prevState[messageId] ?? [];
        if (cur.some((r) => r.id === replyId)) return prevState;
        return {
          ...prevState,
          [messageId]: [...cur, prev].sort((a, b) => a.created_at.localeCompare(b.created_at)),
        };
      });
      setTopError(result.error);
    }
  }, []);

  // ── Realtime subscription ────────────────────────────────────────────
  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`league:${leagueId}:banter`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "banter_messages",
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => addMessage(payload.new as BanterMessage),
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "banter_messages",
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          const id = (payload.old as { id?: string })?.id;
          if (!id) return;
          setMessages((prev) => prev.filter((m) => m.id !== id));
          setReplies((prev) => {
            const { [id]: _drop, ...rest } = prev;
            void _drop;
            return rest;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "banter_replies" },
        (payload) => {
          const reply = payload.new as BanterReply;
          // Client-side filter: parent message must be currently visible.
          // RLS already blocks cross-league reads; this is defence in depth.
          if (!messagesRef.current.some((m) => m.id === reply.message_id)) return;
          addReply(reply);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "banter_replies" },
        (payload) => {
          const id = (payload.old as { id?: string })?.id;
          if (!id) return;
          setReplies((prev) => {
            const out: Record<string, BanterReply[]> = {};
            for (const [mid, list] of Object.entries(prev)) {
              out[mid] = list.filter((r) => r.id !== id);
            }
            return out;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, addMessage, addReply]);

  const orderedMessages = useMemo(
    () => [...messages].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [messages],
  );

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display uppercase tracking-wide text-base">Banter</h2>
        <span className="font-mono-sticker text-[10px] text-ink-soft font-bold">
          {messages.length} {messages.length === 1 ? "post" : "posts"}
        </span>
      </div>

      <BanterComposer
        leagueId={leagueId}
        currentUserId={currentUserId}
        onOptimistic={addMessage}
        onResolved={reconcileMessage}
      />

      {topError && (
        <p className="text-xs text-red font-medium" role="alert">
          {topError}
        </p>
      )}

      {orderedMessages.length === 0 ? (
        <p className="text-sm text-ink-soft">No banter yet. Start the chat 🔥</p>
      ) : (
        <div className="flex flex-col gap-2">
          {orderedMessages.map((m) => (
            <BanterMessageCard
              key={m.id}
              message={m}
              replies={replies[m.id] ?? []}
              expanded={expandedThreads.has(m.id)}
              currentUserId={currentUserId}
              profilesById={profilesById}
              onToggleThread={toggleThread}
              onDeleteMessage={requestDeleteMessage}
              onReplyOptimistic={addReply}
              onReplyResolved={reconcileReply}
              onDeleteReply={requestDeleteReply}
            />
          ))}
        </div>
      )}
    </section>
  );
}
