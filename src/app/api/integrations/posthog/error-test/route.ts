import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  FEATURE_FLAG_OWNER_USER_ID,
  isFeatureEnabled,
  POSTHOG_ERROR_ALERT_FLAG,
} from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const expected = process.env.POSTHOG_ERROR_TEST_TOKEN;
  const supplied = request.headers.get("x-error-test-token");
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    !(await isFeatureEnabled(
      POSTHOG_ERROR_ALERT_FLAG,
      FEATURE_FLAG_OWNER_USER_ID,
    ))
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  throw new Error("HTPR-6238 preview error tracking verification");
}
