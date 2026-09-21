import { logger as htLogger } from "#logger";
import { getAuthSession, withAuth } from "#with-auth";
import { NextRequest, NextResponse } from "next/server";
import { featureFlagsForUser } from "@/lib/flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStore(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function GETHandler(request: NextRequest) {
  try {
    const session = await getAuthSession(request.headers);
    if (!session) return noStore({ error: "Unauthorized" }, 401);
    return noStore({ flags: await featureFlagsForUser(session.userId) });
  } catch (error) {
    htLogger.error("[feature-flags] read failed", error);
    return noStore({ error: "Unable to load feature flags" }, 500);
  }
}

export const GET = withAuth(GETHandler, { authenticateInHandler: true });
