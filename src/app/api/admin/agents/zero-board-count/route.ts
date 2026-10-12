import { NextRequest } from "next/server";
import { isFeatureFlagOwner } from "@/lib/flags";
import { noStore } from "@/lib/flags/http";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    if (!(await isFeatureFlagOwner(request.headers))) {
      return noStore({ error: "Forbidden" }, 403);
    }
    const [zeroBoardActiveAgents, activeAgents] = await Promise.all([
      prisma.agent.count({
        where: { revokedAt: null, archivedAt: null, members: { none: {} } },
      }),
      prisma.agent.count({
        where: { revokedAt: null, archivedAt: null },
      }),
    ]);
    return noStore({ zeroBoardActiveAgents, activeAgents });
  } catch (error) {
    console.error("[admin-agents] count failed", error);
    return noStore({ error: "Unable to count agents" }, 500);
  }
}
