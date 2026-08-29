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
