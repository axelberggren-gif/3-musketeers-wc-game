"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { seedTeams, syncFixtures, syncScorers } from "@/lib/football-data/sync";
import { FootballDataClient } from "@/lib/football-data/client";
import { captureServerActionError } from "@/lib/sentry/capture";

async function assertAdmin() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) throw new Error("Forbidden — admins only");
  return user;
}

export async function runSeedTeams() {
  await assertAdmin();
  try {
    const result = await seedTeams();
    revalidatePath("/admin");
    return { ok: true, ...result } as const;
  } catch (e) {
    return { ok: false, error: await captureServerActionError(e, "runSeedTeams") } as const;
  }
}

export async function runSyncFixtures() {
  await assertAdmin();
  try {
    const result = await syncFixtures();
    revalidatePath("/admin");
    return { ok: true, ...result } as const;
  } catch (e) {
    return { ok: false, error: await captureServerActionError(e, "runSyncFixtures") } as const;
  }
}

export async function runSyncScorers() {
  await assertAdmin();
  try {
    const result = await syncScorers();
    revalidatePath("/admin");
    return { ok: true, ...result } as const;
  } catch (e) {
    return { ok: false, error: await captureServerActionError(e, "runSyncScorers") } as const;
  }
}

export async function runCheckToken() {
  await assertAdmin();
  // TEMP Sentry diagnostic — remove once capture is verified.
  const dsnSeen = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);
  const clientReady = Boolean(Sentry.getClient());
  const runtime = process.env.NEXT_RUNTIME ?? "unknown";
  const vercelEnv = process.env.VERCEL_ENV ?? "local";
  const diag = `dsn=${dsnSeen} client=${clientReady} runtime=${runtime} env=${vercelEnv}`;
  try {
    throw new Error(`sentry-smoke-test [${diag}]`);
    const { teams } = await new FootballDataClient().teams();
    return {
      ok: true,
      teams: teams.length,
      sample: teams[0]?.name ?? null,
    } as const;
  } catch (e) {
    return { ok: false, error: await captureServerActionError(e, "runCheckToken") } as const;
  }
}

export async function overrideMatchResult(formData: FormData) {
  await assertAdmin();
  const matchId = String(formData.get("match_id"));
  const homeScore = Number(formData.get("home_score"));
  const awayScore = Number(formData.get("away_score"));
  if (
    !Number.isInteger(homeScore) ||
    !Number.isInteger(awayScore) ||
    homeScore < 0 ||
    awayScore < 0
  ) {
    return { ok: false, error: "Scores must be non-negative integers." } as const;
  }
  const winner =
    homeScore > awayScore ? "HOME" : homeScore < awayScore ? "AWAY" : "DRAW";

  const service = supabaseService();
  const { error } = await service
    .from("matches")
    .update({
      status: "FINISHED",
      home_score: homeScore,
      away_score: awayScore,
      winner,
      finished_at: new Date().toISOString(),
    })
    .eq("id", matchId);
  if (error) return { ok: false, error: error.message } as const;

  await service.rpc("score_match", { p_match_id: matchId });
  try {
    await service.rpc("score_bracket");
  } catch {}
  try {
    await service.rpc("score_tournament");
  } catch {}
  try {
    await service.rpc("refresh_league_standings");
  } catch {}
  revalidatePath("/admin");
  revalidatePath(`/admin/matches/${matchId}`);
  return { ok: true } as const;
}

export async function setTournamentDates(formData: FormData) {
  await assertAdmin();
  const first = String(formData.get("first_kickoff_at"));
  const ko = String(formData.get("knockout_start_at"));
  const final = String(formData.get("final_at"));
  const service = supabaseService();
  const { error } = await service
    .from("tournament")
    .update({ first_kickoff_at: first, knockout_start_at: ko, final_at: final })
    .eq("id", 1);
  if (error) return { ok: false, error: error.message } as const;
  revalidatePath("/admin");
  return { ok: true } as const;
}

export async function toggleUserAdmin(userId: string, isAdmin: boolean) {
  await assertAdmin();
  const service = supabaseService();
  const { error } = await service.from("profiles").update({ is_admin: isAdmin }).eq("id", userId);
  if (error) return { ok: false, error: error.message } as const;
  revalidatePath("/admin/users");
  return { ok: true } as const;
}
