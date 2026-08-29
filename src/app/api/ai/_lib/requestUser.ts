import type { NextRequest } from "next/server";

import { getCurrentUserFromCookies } from "@/app/api/ai/_lib/editorAi";
import { validateMcpAuth } from "@/lib/mcp/auth";
import { hasOAuthAccessTokenClaims } from "@/lib/mcp/oauthTokenContract";

export type AiRequestUser = {
  id: number;
  email?: string;
  displayName?: string | null;
};

/**
 * Web AI continues to use its first-party cookie. Native Android may fall back
 * to the user OAuth access token issued by the existing PKCE flow.
 */
export async function getAiRequestUser(
  request: NextRequest
): Promise<AiRequestUser | null> {
  const cookieUser = await getCurrentUserFromCookies();
  if (Number.isInteger(cookieUser?.id) && Number(cookieUser?.id) > 0) {
    return {
      id: Number(cookieUser?.id),
      email: cookieUser?.email,
      displayName: cookieUser?.displayName,
    };
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  if (token.split(".").length !== 3 || !hasOAuthAccessTokenClaims(token)) {
    return null;
  }

  const context = await validateMcpAuth(request);
  if (!context || context.agentId || context.management) return null;
  return context.user;
}
