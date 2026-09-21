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

// Server capture only runs on preview and production (see
// capturePostHogExceptionOnServer), and this repo does not build previews by
// default, so production is the only place the pipeline can actually be
// demonstrated. Three independent gates keep that safe: the deployment
// environment, the Owner-only feature flag, and an explicit admin-only
// authorization (a real session of the owner user — Manager decision
// 2026-09-09). The shared token is kept as a fourth gate: a cross-site form
// POST cannot set a custom header, so it also blocks CSRF on the
// cookie-authenticated session. Any gate failing makes the route a 404/401.
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
