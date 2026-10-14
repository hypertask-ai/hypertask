import { NextRequest, NextResponse } from "next/server";

import {
  deleteGuestCascade,
  findStaleGuestIds,
} from "@/lib/demo/cleanupGuest";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";

export const runtime = "nodejs";
export const maxDuration = 300;

const GUEST_DELETE_CONCURRENCY = 4;

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
      const guestId = chunk[index];
      failures.push(guestId);
      console.error(`guest cleanup failed for user ${guestId}`, result.reason);
    });
  }

  return NextResponse.json({ deleted, failed: failures });
}
