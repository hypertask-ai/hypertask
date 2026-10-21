export const MCP_TOKEN_MASK = "***";

export function isUsableMcpBearerToken(
  token: string | null | undefined,
): token is string {
  return Boolean(token) && token !== MCP_TOKEN_MASK;
}

export function mcpAuthorizationHeaders(
  token: string | null | undefined,
): Record<string, string> {
  return isUsableMcpBearerToken(token)
    ? { Authorization: `Bearer ${token}` }
    : {};
}

export function readMcpTokenCookieValue(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith("mcp_token=")) continue;
    const value = trimmed.slice("mcp_token=".length);
    return value || null;
  }
  return null;
}
