import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import type { McpAuthContext } from "@/lib/mcp/auth/types";
import type { SessionUser } from "@/lib/auth/getSessionUser";
import { JWT_ISSUER, JWT_MCP_AUDIENCE, MCP_TOKEN_ISSUED_AT_MS_CLAIM, validateJwtToken } from "@/lib/mcp/auth/verifyJwt";
import { HTPR_7699_DESKTOP_CLI_TOKEN_FLAG, isFeatureEnabled } from "@/lib/flags";

export type DesktopCliEndpoint = "task-writer" | "task-defaults" | "comment-star-pin" | "mention-search" | "shared-session" | "task-write";

type DesktopCliTokenUser = SessionUser & {
  source: "cli-bearer";
  user: McpAuthContext["user"];
};

function hasHumanCliTokenClaims(token: string): boolean {
  if (token.split(".").length !== 3) return false;
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === "string") return false;
  const audiences = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
  const issuedAtMs = decoded[MCP_TOKEN_ISSUED_AT_MS_CLAIM];
  const issuedAt = typeof issuedAtMs === "number" && Number.isFinite(issuedAtMs)
    ? issuedAtMs
    : typeof decoded.iat === "number" ? decoded.iat * 1000 : NaN;
  return (
    decoded.iss === JWT_ISSUER &&
    audiences.length === 1 &&
    audiences[0] === JWT_MCP_AUDIENCE &&
    !Object.hasOwn(decoded, "agentId") &&
    typeof decoded.exp === "number" && Number.isFinite(decoded.exp) &&
    issuedAt > 0 && Number.isFinite(new Date(issuedAt).getTime())
  );
}

function logDecision(
  endpoint: DesktopCliEndpoint,
  decision: "allow" | "refuse",
  reason: "not_cli_token" | "invalid_token" | "scoped_token" | "flag_off" | "flag_error" | "validation_error" | "human_cli_token",
  userId?: number,
) {
  console.info("[desktop/cli-bearer]", { endpoint, decision, reason, ...(userId ? { userId } : {}) });
}

export function logDesktopCliAuthorization(session: Pick<SessionUser, "source" | "userId"> | null | undefined, endpoint: DesktopCliEndpoint, status: number, request?: Pick<NextApiRequest, "url" | "method">) {
  if (session?.source !== "cli-bearer") return;
  console.info("[desktop/cli-authorization]", {
    endpoint,
    ...(request ? { path: request.url?.split("?", 1)[0]?.slice(0, 200), method: request.method } : {}),
    userId: session.userId,
    decision: status < 400 ? "allow" : "refuse",
    reason: status < 400 ? "authorized" : "request_refused",
    status,
  });
}

export async function getDesktopCliTokenUser(headers: Headers, endpoint: DesktopCliEndpoint): Promise<DesktopCliTokenUser | null> {
  const authorization = headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  try {
    if (!hasHumanCliTokenClaims(token)) {
      logDecision(endpoint, "refuse", "not_cli_token");
      return null;
    }
    const context = await validateJwtToken(token, { boundedLogging: true });
    if (!context || !Number.isInteger(context.user.id) || context.user.id <= 0) {
      logDecision(endpoint, "refuse", "invalid_token");
      return null;
    }
    if (context.agentId || context.management || context.teamScope) {
      logDecision(endpoint, "refuse", "scoped_token", context.user.id);
      return null;
    }
    const enabled = await isFeatureEnabled(HTPR_7699_DESKTOP_CLI_TOKEN_FLAG, context.user.id).catch(() => null);
    if (!enabled) {
      logDecision(endpoint, "refuse", enabled === null ? "flag_error" : "flag_off", context.user.id);
      return null;
    }
    logDecision(endpoint, "allow", "human_cli_token", context.user.id);
    return { user: context.user, userId: context.user.id, teamScope: null, source: "cli-bearer" };
  } catch {
    logDecision(endpoint, "refuse", "validation_error");
    return null;
  }
}

export function logDesktopCliResponse(session: SessionUser | null, request: Pick<NextApiRequest, "url" | "method">, response: Pick<NextApiResponse, "once" | "statusCode">) {
  if (session?.source !== "cli-bearer") return;
  response.once("finish", () => logDesktopCliAuthorization(session, "shared-session", response.statusCode, request));
}
