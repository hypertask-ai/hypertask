import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { FeatureFlagApprovalError } from "@/lib/flags";

export const MANAGER_LEASE_LOCK_NAMESPACE = 8_010_801;
export const MANAGER_GRANT_HEADER = "x-manager-grant";
export const MANAGER_LEASE_MAX_TTL_MINUTES = 240;

const MANAGER_AGENT_NAMES = new Set(["HT Finance", "Mini Boss CEO", "Chief Of Staff", "INFRA MANAGER"]);
const MANAGER_AGENT_PATTERN = /^HT [A-Za-z]+(?: [A-Za-z]+)* Lead$/;
const GRANT_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const GRANT_HASH = /^[0-9a-f]{64}$/;

export type ManagerLeaseAction = "take" | "renew" | "release" | "handoff";

export class ManagerLeaseError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 409) {
    super(message);
  }
}

export function isManagerClassAgentName(displayName: string): boolean {
  return MANAGER_AGENT_NAMES.has(displayName) || MANAGER_AGENT_PATTERN.test(displayName);
}

export function hashManagerGrant(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function refusal(reason: string): FeatureFlagApprovalError {
  return new FeatureFlagApprovalError(`Manager lease proof refused: ${reason}. Switch flags only while you hold the current manager lease and send your take receipt token in the X-Manager-Grant header.`);
}

export async function requireCurrentManagerGrant(
  tx: Prisma.TransactionClient,
  input: { agentId: string; grant: string | null; now?: Date },
): Promise<void> {
  if (!input.grant) throw refusal("no grant sent");
  if (!GRANT_TOKEN.test(input.grant)) throw refusal("grant is malformed");
  const tokenHash = hashManagerGrant(input.grant);
  await tx.$queryRaw`SELECT id FROM "ManagerLeaseGrant" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
  const row = await tx.managerLeaseGrant.findUnique({ where: { tokenHash } });
  if (!row || row.agentId !== input.agentId) throw refusal("grant is unknown");
  if (row.releasedAt) throw refusal("grant was released");
  if (row.replacedAt) throw refusal("grant was replaced");
  if (row.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) throw refusal("grant expired");
}

export async function applyManagerLeaseAction(
  tx: Prisma.TransactionClient,
  input: { agentId: string; action: ManagerLeaseAction; session?: string; grantHash?: string; grant?: string; ttlMinutes?: number; now?: Date },
): Promise<{ expiresAt: Date | null }> {
  const now = input.now ?? new Date();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(CAST(${MANAGER_LEASE_LOCK_NAMESPACE} AS integer), 0)`;

  if (input.action === "take") {
    const ttl = input.ttlMinutes;
    if (!input.session || input.session.length > 100 || !input.grantHash || !GRANT_HASH.test(input.grantHash)
      || !Number.isInteger(ttl) || (ttl as number) < 1 || (ttl as number) > MANAGER_LEASE_MAX_TTL_MINUTES) {
      throw new ManagerLeaseError("take needs session, grantHash (64 hex) and ttlMinutes (1 to 240)", 400);
    }
    const live = await tx.managerLeaseGrant.findFirst({
      where: { releasedAt: null, replacedAt: null, expiresAt: { gt: now } },
      select: { session: true },
    });
    if (live) throw new ManagerLeaseError(`manager lease held by ${live.session}`, 409);
    await tx.managerLeaseGrant.updateMany({
      where: { releasedAt: null, replacedAt: null },
      data: { replacedAt: now },
    });
    const expiresAt = new Date(now.getTime() + (ttl as number) * 60_000);
    await tx.managerLeaseGrant.create({
      data: { agentId: input.agentId, session: input.session, tokenHash: input.grantHash, ttlMinutes: ttl as number, expiresAt },
    });
    return { expiresAt };
  }

  if (!input.grant || !GRANT_TOKEN.test(input.grant)) {
    throw new ManagerLeaseError(`${input.action} needs the grant from your take receipt`, 400);
  }
  const tokenHash = hashManagerGrant(input.grant);
  const row = await tx.managerLeaseGrant.findUnique({ where: { tokenHash } });
  if (!row || row.agentId !== input.agentId || row.releasedAt || row.replacedAt || row.expiresAt.getTime() <= now.getTime()) {
    throw new ManagerLeaseError("grant is unknown, replaced, released or expired", 403);
  }
  if (input.action === "renew") {
    const expiresAt = new Date(now.getTime() + row.ttlMinutes * 60_000);
    await tx.managerLeaseGrant.update({ where: { tokenHash }, data: { expiresAt, renewedAt: now } });
    return { expiresAt };
  }
  await tx.managerLeaseGrant.update({ where: { tokenHash }, data: { releasedAt: now, endedReason: input.action } });
  return { expiresAt: null };
}
