import { supabaseServer } from "@/lib/supabase/server";
import {
  type PickKind,
  type PickReactionEmoji,
  type PickReactionAggregate,
} from "@/lib/predictions/reactions-shared";

const emptyCounts = (): Record<PickReactionEmoji, number> => ({
  "🔥": 0,
  "💩": 0,
  "😱": 0,
  "👍": 0,
});

export async function loadPickReactions(
  picks: { id: string; kind: PickKind }[],
  viewerId: string | null,
): Promise<Map<string, PickReactionAggregate>> {
  const out = new Map<string, PickReactionAggregate>();
  if (picks.length === 0) return out;

  for (const p of picks) {
    out.set(`${p.kind}:${p.id}`, { counts: emptyCounts(), mine: new Set() });
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("pick_reactions")
    .select("pick_id, pick_kind, emoji, user_id")
    .in("pick_id", picks.map((p) => p.id));
  if (error || !data) return out;

  for (const r of data) {
    const key = `${r.pick_kind}:${r.pick_id}`;
    const agg = out.get(key);
    if (!agg) continue;
    const emoji = r.emoji as PickReactionEmoji;
    agg.counts[emoji] = (agg.counts[emoji] ?? 0) + 1;
    if (viewerId && r.user_id === viewerId) agg.mine.add(emoji);
  }
  return out;
}
