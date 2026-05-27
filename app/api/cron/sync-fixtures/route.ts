import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { syncFixtures } from "@/lib/football-data/sync";
import { authorizedCron } from "@/lib/cron/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!authorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await syncFixtures();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    Sentry.captureException(e, { tags: { cron: "sync-fixtures" } });
    const err = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: err }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
