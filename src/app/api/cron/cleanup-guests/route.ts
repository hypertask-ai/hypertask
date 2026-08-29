import { NextRequest, NextResponse } from "next/server";

import {
  deleteGuestCascade,
  findStaleGuestIds,
} from "@/lib/demo/cleanupGuest";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";

export const runtime = "nodejs";
export const maxDuration = 300;

// HTPR-4303: hourly Vercel cron (vercel.json) that hard-deletes anonymous
// demo guests idle for 24h+, cascading their boards/teams. Worst case for an
// unauthorized caller is an early run of the same cleanup, but gate anyway.
export async function GET(request: NextRequest) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const staleGuestIds = await findStaleGuestIds();
  let deleted = 0;
  const failures: number[] = [];

  for (const guestId of staleGuestIds) {
    try {
      await deleteGuestCascade(guestId);
      deleted += 1;
    } catch (error) {
      // One bad guest must not abort the batch; the next run retries it.
      failures.push(guestId);
      console.error(`guest cleanup failed for user ${guestId}`, error);
    }
  }

  return NextResponse.json({ deleted, failed: failures });
}
