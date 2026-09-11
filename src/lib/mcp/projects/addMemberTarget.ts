/**
 * Pure helpers for MCP POST /projects/:id/members decisioning.
 * Kept free of Next/prisma so node:test can cover the invite-vs-add contract.
 */

export type McpAddMemberTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "user_id"; userId: number }
  | { kind: "email"; email: string }
  | { kind: "invalid"; reason: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveMcpAddMemberTarget(userToAdd: unknown): McpAddMemberTarget {
  const isNonEmptyString = (val: unknown): val is string =>
    typeof val === "string" && val.trim().length > 0;

  const isPositiveInteger = (val: unknown): val is number =>
    typeof val === "number" &&
    Number.isInteger(val) &&
    val > 0 &&
    val <= 2147483647;

  if (
    isNonEmptyString(userToAdd) &&
    UUID_PATTERN.test(userToAdd.trim())
  ) {
    return { kind: "agent", agentId: userToAdd.trim() };
  }

  if (isPositiveInteger(userToAdd)) {
    return { kind: "user_id", userId: userToAdd };
  }

  if (isNonEmptyString(userToAdd) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userToAdd)) {
    return { kind: "email", email: userToAdd.trim() };
  }

  return {
    kind: "invalid",
    reason:
      "userToAdd must be a non-empty email string, a positive integer user ID, or an agent UUID",
  };
}

export function mcpPendingInviteResponse(projectId: number, inviteId: string | null) {
  return {
    success: true as const,
    projectId,
    status: "pending_invite" as const,
    inviteId,
  };
}

export function mcpAddedMemberResponse(
  projectId: number,
  outcome: "added" | "already_member",
  member: {
    id: number | null;
    userId: number;
    displayName: string | null;
    email: string | null;
  },
) {
  return {
    success: true as const,
    projectId,
    status: outcome,
    member,
  };
}
