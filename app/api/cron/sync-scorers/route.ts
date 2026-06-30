import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { syncScorers } from "@/lib/football-data/sync";
import { authorizedCron } from "@/lib/cron/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// syncScorers() drains up to 8 per-match detail fetches under a 10-req/min
// limit, so it can run long; give it room before Vercel kills the function.
// Pairs with the 30 s pg_net timeout in migration 0034_cron_http_timeout.sql.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!authorizedCron(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
