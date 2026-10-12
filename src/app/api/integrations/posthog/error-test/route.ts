import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  FEATURE_FLAG_OWNER_USER_ID,
  isFeatureEnabled,
  isFeatureFlagOwner,
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

// Interactive verification still requires the owner's session and test token.
// CI may only throw a uniquely named canary on production using the same secret;
// it cannot select arbitrary messages or perform any other operation.
const TRIGGERABLE_ENVIRONMENTS = new Set(["preview", "production"]);

export async function POST(request: NextRequest) {
  if (!TRIGGERABLE_ENVIRONMENTS.has(process.env.VERCEL_ENV || "")) {
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
  const canary = request.headers.get("x-posthog-canary");
  if (canary) {
    if (process.env.VERCEL_ENV !== "production") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!/^yper4-331-[0-9]{1,20}-[0-9]{1,3}$/.test(canary)) {
      return NextResponse.json({ error: "Invalid canary" }, { status: 400 });
    }
    if (!authorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw new Error(`PostHog pipeline canary ${canary}`);
  }
  if (!(await isFeatureFlagOwner(request.headers))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // This string becomes the PostHog issue name and the auto-filed ticket
  // title, so it is the evidence a human reads. Keep it environment-neutral.
  throw new Error("HTPR-6238 deliberate error tracking verification");
}
