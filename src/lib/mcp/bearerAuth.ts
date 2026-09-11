/** Display placeholder from GET /api/mcp/token when the real JWT is cookie-only. */
export const MCP_TOKEN_MASK = "***";

/**
 * True when `token` is a real bearer JWT we can send. The masked "***"
 * placeholder is truthy but invalid; sending it as Authorization makes
 * /api/ai/hyper-mentioned (and similar routes) skip cookie session auth and
 * return 401, so @HyperAI stays silent.
 */
export function isUsableMcpBearerToken(
  token: string | null | undefined,
): token is string {
  return Boolean(token) && token !== MCP_TOKEN_MASK;
}

/** Browser fetch headers for optional MCP bearer auth. Omits Authorization for the "***" mask. */
export function mcpAuthorizationHeaders(
  token: string | null | undefined,
): Record<string, string> {
  return isUsableMcpBearerToken(token)
    ? { Authorization: `Bearer ${token}` }
    : {};
}

/** Read mcp_token from a document.cookie string without truncating JWT "=" padding. */
export function readMcpTokenCookieValue(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith("mcp_token=")) continue;
    const value = trimmed.slice("mcp_token=".length);
    return value || null;
  }
  return null;
}
