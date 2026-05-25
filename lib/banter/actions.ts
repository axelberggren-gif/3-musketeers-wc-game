"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { captureServerActionError } from "@/lib/sentry/capture";

const MAX_BODY = 180;

async function authedClient() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

function validateBody(body: string): { ok: true; trimmed: string } | { ok: false; error: string } {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Message cannot be empty." };
  if (trimmed.length > MAX_BODY) return { ok: false, error: `Max ${MAX_BODY} characters.` };
  return { ok: true, trimmed };
}

export async function postBanter(
  leagueId: string,
  body: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const v = validateBody(body);
  if (!v.ok) return v;
  try {
    const { supabase, user } = await authedClient();
    const { data, error } = await supabase
      .from("banter_messages")
      .insert({ league_id: leagueId, user_id: user.id, body: v.trimmed })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data.id };
  } catch (e) {
    await captureServerActionError(e, "postBanter");
    return { ok: false, error: e instanceof Error ? e.message : "Failed to post." };
  }
}

export async function postBanterReply(
  messageId: string,
  body: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const v = validateBody(body);
  if (!v.ok) return v;
  try {
    const { supabase, user } = await authedClient();
    const { data, error } = await supabase
      .from("banter_replies")
      .insert({ message_id: messageId, user_id: user.id, body: v.trimmed })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data.id };
  } catch (e) {
    await captureServerActionError(e, "postBanterReply");
    return { ok: false, error: e instanceof Error ? e.message : "Failed to post reply." };
  }
}

export async function deleteBanterMessage(
  messageId: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { supabase } = await authedClient();
    const { data, error } = await supabase
      .from("banter_messages")
      .delete()
      .eq("id", messageId)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Not found or not authorized." };
    return { ok: true, id: data.id };
  } catch (e) {
    await captureServerActionError(e, "deleteBanterMessage");
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete." };
  }
}

export async function deleteBanterReply(
  replyId: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { supabase } = await authedClient();
    const { data, error } = await supabase
      .from("banter_replies")
      .delete()
      .eq("id", replyId)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Not found or not authorized." };
    return { ok: true, id: data.id };
  } catch (e) {
    await captureServerActionError(e, "deleteBanterReply");
    return { ok: false, error: e instanceof Error ? e.message : "Failed to delete reply." };
  }
}
