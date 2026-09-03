import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { featureFlagsForUser } from "@/lib/flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStore(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUser(request.headers);
    if (!session) return noStore({ error: "Unauthorized" }, 401);
    return noStore({ flags: await featureFlagsForUser(session.userId) });
  } catch (error) {
    console.error("[feature-flags] read failed", error);
    return noStore({ error: "Unable to load feature flags" }, 500);
  }
}
