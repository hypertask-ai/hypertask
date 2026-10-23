import { NextRequest } from "next/server";
import { isFeatureFlagOwnerUserId } from "@/lib/flags";
import { noStore } from "@/lib/flags/http";
import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";

export async function authorize(request: NextRequest) {
  const limited = await checkMcpRateLimit(request);
  if (limited) {
    limited.headers.set("Cache-Control", "private, no-store");
    return limited;
  }
  const ctx = await validateMcpAuth(request, { deferManagementPermissionCheck: true });
  if (!ctx) return noStore({ error: "Unauthorized" }, 401);
  if (!ctx.agentId || ctx.management || !(await isFeatureFlagOwnerUserId(ctx.user.id))) {
    return noStore({ error: "Forbidden" }, 403);
  }
  return ctx;
}

