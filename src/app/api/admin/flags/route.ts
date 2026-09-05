import { NextRequest, NextResponse } from "next/server";
import {
  FEATURE_FLAG_DETAILS_FLAG,
  FEATURE_FLAG_MODES,
  FEATURE_FLAG_OWNER_USER_ID,
  FeatureFlagInputError,
  isFeatureEnabled,
  isFeatureFlagOwner,
  listFeatureFlagModes,
  setFeatureFlagMode,
  type FeatureFlagMode,
} from "@/lib/flags";
import { broadcastFeatureFlagsChange } from "@/lib/realtime/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStore(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function trustedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.slice(0, -1);
  if (!origin || !host || !protocol) return false;
  try {
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!(await isFeatureFlagOwner(request.headers))) {
      return noStore({ error: "Not found" }, 404);
    }
    const [flags, detailsEnabled] = await Promise.all([
      listFeatureFlagModes({ includeTicketTitles: true }),
      isFeatureEnabled(FEATURE_FLAG_DETAILS_FLAG, FEATURE_FLAG_OWNER_USER_ID),
    ]);
    return noStore({ flags, detailsEnabled });
  } catch (error) {
    console.error("[feature-flags] admin read failed", error);
    return noStore({ error: "Unable to load feature flags" }, 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (!(await isFeatureFlagOwner(request.headers))) {
      return noStore({ error: "Not found" }, 404);
    }
    if (!trustedOrigin(request)) return noStore({ error: "Forbidden" }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return noStore({ error: "Content-Type must be application/json" }, 415);
    }

    const text = await request.text();
    if (text.length > 1024) return noStore({ error: "Request is too large" }, 413);
    const body = JSON.parse(text) as { key?: unknown; mode?: unknown } | null;
    if (
      !body ||
      Array.isArray(body) ||
      typeof body.key !== "string" ||
      typeof body.mode !== "string" ||
      !FEATURE_FLAG_MODES.includes(body.mode as FeatureFlagMode)
    ) {
      return noStore({ error: "Invalid feature flag" }, 400);
    }
    const flag = await setFeatureFlagMode(body.key, body.mode as FeatureFlagMode);
    await broadcastFeatureFlagsChange().catch((error) =>
      console.warn("[feature-flags] realtime broadcast failed", error),
    );
    return noStore({ flag });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof FeatureFlagInputError) {
      return noStore(
        { error: error instanceof FeatureFlagInputError ? error.message : "Invalid JSON" },
        400,
      );
    }
    console.error("[feature-flags] update failed", error);
    return noStore({ error: "Unable to update feature flag" }, 500);
  }
}
