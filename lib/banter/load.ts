import { supabaseServer } from "@/lib/supabase/server";
import type { BanterMessage, BanterReply } from "@/lib/supabase/types";

export interface BanterBootstrap {
  /** Ascending order for BanterFeed state; the render layer re-sorts descending. */
  initialMessages: BanterMessage[];
  initialReplies: Record<string, BanterReply[]>;
}

/**
 * Initial data for a `<BanterFeed leagueId={...}>` mount: the latest 50
 * messages plus their reply threads, RLS-scoped to the viewer's membership.
 * Shared by the league home page and /today — both mount the same feed on the
 * same `league:<id>:banter` Realtime channel, so posts made on either page
 * appear on the other live.
 */
export async function loadBanter(leagueId: string): Promise<BanterBootstrap> {
  const supabase = await supabaseServer();

  const { data: messagesDesc } = await supabase
    .from("banter_messages")
    .select("id, league_id, user_id, body, created_at")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false })
    .limit(50);

  const initialMessages = ([...(messagesDesc ?? [])] as BanterMessage[]).reverse();
  const messageIds = initialMessages.map((m) => m.id);

  const initialReplies: Record<string, BanterReply[]> = {};
  if (messageIds.length > 0) {
    const { data: replies } = await supabase
      .from("banter_replies")
      .select("id, message_id, user_id, body, created_at")
      .in("message_id", messageIds)
      .order("created_at", { ascending: true });
    for (const r of (replies ?? []) as BanterReply[]) {
      (initialReplies[r.message_id] ??= []).push(r);
    }
  }

  return { initialMessages, initialReplies };
}
