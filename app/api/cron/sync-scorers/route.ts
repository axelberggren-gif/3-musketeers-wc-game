import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { syncScorers } from "@/lib/football-data/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await syncScorers();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: "sync-scorers" } });
    const err = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: err }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("x-cron-secret") ?? request.headers.get("authorization");
  if (!header) return false;
  return header === secret || header === `Bearer ${secret}`;
}
