import { Prisma } from "@prisma/client";

/** Agent fields that are safe to serialize outside agent-management routes. */
export const publicAgentSelect = {
  id: true,
  userId: true,
  displayName: true,
  photoURL: true,
  createdAt: true,
  revokedAt: true,
  runtimeType: true,
  heartbeatAt: true,
  permissions: true,
} satisfies Prisma.AgentSelect;

export type PublicAgent = Prisma.AgentGetPayload<{
  select: typeof publicAgentSelect;
}>;

const agentRelationKeys = new Set([
  "agent",
  "agentAssigner",
  "fromAgent",
  "toAgent",
  "addedByAgent",
]);

export const PRIVATE_AGENT_DISPLAY_NAME = "Private agent";

const privateAgentAttribution = {
  displayName: PRIVATE_AGENT_DISPLAY_NAME,
  photoURL: null,
};

function isAgentRelationKey(key: string): boolean {
  return (
    agentRelationKeys.has(key) ||
    key.endsWith("Agent") ||
    key.endsWith("_agent")
  );
}

function isAgentCollectionKey(key: string): boolean {
  return (
    key === "agents" || key.endsWith("Agents") || key.endsWith("_agents")
  );
}

function isAgentIdentifierKey(key: string): boolean {
  return (
    key === "agentId" ||
    key.endsWith("AgentId") ||
    key.endsWith("_agent_id")
  );
}

function isAgentDisplayNameKey(key: string): boolean {
  return (
    key === "agentDisplayName" ||
    key.endsWith("AgentDisplayName") ||
    key.endsWith("_agent_display_name")
  );
}

const agentCredentialKeys = new Set([
  // "mcpToken" is gone from the schema, but historical activity JSON can still
  // hold rows captured while it existed, so it stays on this list.
  "mcpToken",
  "mcpTokenHash",
  "mcpTokenJti",
  "mcpTokenExpiresAt",
  "prompt",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function projectPublicAgent(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;

  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(publicAgentSelect)) {
    if (key in value) projected[key] = value[key];
  }
  return projected;
}

export function redactAgentIdentitiesForPublicShare<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(redactAgentIdentitiesForPublicShare) as T;
  }
  if (!isRecord(value) || value instanceof Date) return value;

  const fromAgentId = isRecord(value.fromAgent) ? value.fromAgent.id : undefined;
  const toAgentId = isRecord(value.toAgent) ? value.toAgent.id : undefined;
  const isSelfAssignment =
    typeof fromAgentId === "string" && typeof toAgentId === "string"
      ? fromAgentId === toAgentId
      : undefined;
  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isAgentIdentifierKey(key)) {
      redacted[key] = null;
    } else if (isAgentDisplayNameKey(key)) {
      redacted[key] = nested ? privateAgentAttribution.displayName : nested;
    } else if (isAgentRelationKey(key)) {
      redacted[key] = nested == null ? nested : { ...privateAgentAttribution };
    } else if (isAgentCollectionKey(key)) {
      redacted[key] = Array.isArray(nested)
        ? nested.map(() => ({ ...privateAgentAttribution }))
        : [];
    } else {
      redacted[key] = redactAgentIdentitiesForPublicShare(nested);
    }
  }
  if (isSelfAssignment !== undefined) {
    redacted.isSelfAssignment = isSelfAssignment;
  }
  return redacted as T;
}

/**
 * Historical activity JSON can contain full Prisma Agent rows. Project every
 * known agent relation through the public allowlist and remove credential keys
 * defensively from any unexpected nesting.
 */
export function sanitizeAgentCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAgentCredentials);
  if (!isRecord(value) || value instanceof Date) return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (agentCredentialKeys.has(key)) continue;
    if (agentRelationKeys.has(key) && isRecord(nested)) {
      sanitized[key] = projectPublicAgent(nested);
      continue;
    }
    sanitized[key] = sanitizeAgentCredentials(nested);
  }
  return sanitized;
}
