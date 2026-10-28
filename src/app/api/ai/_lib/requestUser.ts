import type { NextRequest } from "next/server";
import jwt from "jsonwebtoken";

import { getCurrentUserFromCookies } from "@/app/api/ai/_lib/editorAi";
import { validateMcpAuth } from "@/lib/mcp/auth";
import { hasOAuthAccessTokenClaims } from "@/lib/mcp/oauthTokenContract";
import { JWT_ISSUER, JWT_MCP_AUDIENCE } from "@/lib/mcp/auth/verifyJwt";
import { HTPR_7684_DESKTOP_AI_CHAT_BEARER_FLAG, HTPR_7699_DESKTOP_CLI_TOKEN_FLAG, isFeatureEnabled } from "@/lib/flags";

export type AiRequestUser = {
  source?: "cli-bearer";
  id: number;
  email?: string;
  displayName?: string | null;
};

export type CliBearerChatEndpoint = "chat-stream" | "chat-cancel" | "all-sessions";

const SIDEBAR_CHAT_PROJECT_HEADER = "x-hypertask-sidebar-project";

export async function getAiRequestUser(
  request: NextRequest
): Promise<AiRequestUser | null> {
  const cookieUser = await getCurrentUserFromCookies();
  if (cookieUser && Number.isInteger(cookieUser.id) && Number(cookieUser.id) > 0) {
    if (cookieUser.source === "cli-bearer" &&
        !await isFeatureEnabled(HTPR_7699_DESKTOP_CLI_TOKEN_FLAG, cookieUser.id).catch(() => false)) {
      return null;
    }
    return {
      ...(cookieUser.source === "cli-bearer" ? { source: cookieUser.source } : {}),
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

function hasHumanCliTokenClaims(token: string): boolean {
  if (token.split(".").length !== 3) return false;
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === "string") return false;
  const audiences = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
  return (
    decoded.iss === JWT_ISSUER &&
    audiences.length === 1 &&
    audiences[0] === JWT_MCP_AUDIENCE &&
    !Object.hasOwn(decoded, "agentId")
  );
}

function logCliBearerDecision(
  endpoint: CliBearerChatEndpoint,
  decision: "allow" | "refuse",
  reason: string,
  userId?: number,
) {
  console.info("[ai/cli-bearer]", { endpoint, decision, reason, ...(userId ? { userId } : {}) });
}

export async function getCliBearerChatUser(
  request: NextRequest,
  endpoint: CliBearerChatEndpoint,
): Promise<AiRequestUser | null> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  if (!hasHumanCliTokenClaims(token)) {
    logCliBearerDecision(endpoint, "refuse", "not_cli_token");
    return null;
  }

  const context = await validateMcpAuth(request);
  if (!context) {
    logCliBearerDecision(endpoint, "refuse", "invalid_token");
    return null;
  }
  if (context.agentId || context.management || context.teamScope) {
    logCliBearerDecision(endpoint, "refuse", "agent_or_scoped", context.user.id);
    return null;
  }

  if (request.headers.has(SIDEBAR_CHAT_PROJECT_HEADER)) {
    logCliBearerDecision(endpoint, "refuse", "sidebar_not_supported", context.user.id);
    return null;
  }

  const enabled = await isFeatureEnabled(HTPR_7684_DESKTOP_AI_CHAT_BEARER_FLAG, context.user.id).catch(() => null);
  if (!enabled) {
    logCliBearerDecision(endpoint, "refuse", enabled === null ? "flag_error" : "flag_off", context.user.id);
    return null;
  }

  logCliBearerDecision(endpoint, "allow", "human_cli_token", context.user.id);
  return context.user;
}
