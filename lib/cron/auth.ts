import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export function authorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header =
    request.headers.get("x-cron-secret") ?? request.headers.get("authorization");
  if (!header) return false;
  return constantTimeEqual(header, secret) || constantTimeEqual(header, `Bearer ${secret}`);
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
