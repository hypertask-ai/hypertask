import jwt from "jsonwebtoken";

import {
  createMcpToken,
  revokeOwnedTokenByJti,
  verifyMcpJwtToken,
} from "@/lib/mcp/auth";
import prisma from "@/lib/prisma";

export class InvalidAccountMcpTokenError extends Error {
  constructor() {
    super("Provide a valid, unexpired account MCP token owned by this account");
    this.name = "InvalidAccountMcpTokenError";
  }
}

export function ownedAccountTokenRevocationTarget(
  token: string,
  userId: number,
) {
  const decoded = verifyMcpJwtToken(token);
  const jti = decoded?.jti ?? decoded?.jwtid;
  if (
    !decoded ||
    decoded.userId !== userId ||
    decoded.agentId !== undefined ||
    typeof jti !== "string" ||
    jti.length === 0 ||
    typeof decoded.exp !== "number" ||
    !Number.isFinite(decoded.exp)
  ) {
    throw new InvalidAccountMcpTokenError();
  }
  return { jti, expiresAt: new Date(decoded.exp * 1000) };
}

export function mintAccountMcpToken(
  user: { id: number; email: string },
  expiresInDays: number,
) {
  const token = createMcpToken(user.id, user.email, `${expiresInDays}d`);
  const decoded = jwt.decode(token) as jwt.JwtPayload;
  return {
    success: true as const,
    token,
    jti: decoded.jti,
    expires_at: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
    warning: "Store this token securely. It will not be shown again.",
  };
}

export async function revokeAccountMcpToken(
  userId: number,
  input: { token?: string; revoke_all?: true },
) {
  if (input.revoke_all) {
    await prisma.user.update({
      where: { id: userId },
      data: { mcpTokensRevokedAt: new Date() },
    });
    return { success: true as const, revoked_all: true as const };
  }

  const { jti, expiresAt } = ownedAccountTokenRevocationTarget(
    input.token as string,
    userId,
  );
  await revokeOwnedTokenByJti(jti, userId, expiresAt);
  return { success: true as const, revoked_jti: jti };
}
