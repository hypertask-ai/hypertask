import { NextRequest, NextResponse } from "next/server";

import {
  deleteGuestCascade,
  findStaleGuestIds,
} from "@/lib/demo/cleanupGuest";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";

export const runtime = "nodejs";
export const maxDuration = 300;

const GUEST_DELETE_CONCURRENCY = 4;

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

  // HTPR-6509: guests are independent, so run a few cascades at once. The
  // chunk stays well under the pg pool size (10) so other requests still get
  // connections.
  for (let start = 0; start < staleGuestIds.length; start += GUEST_DELETE_CONCURRENCY) {
    const chunk = staleGuestIds.slice(start, start + GUEST_DELETE_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((guestId) => deleteGuestCascade(guestId)),
    );
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        deleted += 1;
        return;
      }
      // One bad guest must not abort the batch; the next run retries it.
      const guestId = chunk[index];
      failures.push(guestId);
      console.error(`guest cleanup failed for user ${guestId}`, result.reason);
    });
  }

  return NextResponse.json({ deleted, failed: failures });
}
