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
const OPERATION_ID = /^[A-Za-z0-9_-]{16,64}$/;

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

function denied(): ManagerLeaseError {
  return new ManagerLeaseError("grant is unknown, replaced, released or expired", 403);
}

function live(row: { releasedAt: Date | null; replacedAt: Date | null; expiresAt: Date }, now: Date): boolean {
  return row.releasedAt === null && row.replacedAt === null && row.expiresAt.getTime() > now.getTime();
}

async function remember(
  tx: Prisma.TransactionClient,
  input: { agentId: string; operationId: string; action: ManagerLeaseAction; grantHash: string; expiresAt: Date | null },
): Promise<void> {
  await tx.managerLeaseOperation.create({ data: input });
}

export async function readManagerLeaseOperation(
  tx: Prisma.TransactionClient,
  input: { agentId: string; operationId: string },
): Promise<{ action: string; expiresAt: Date | null } | null> {
  if (!OPERATION_ID.test(input.operationId)) {
    throw new ManagerLeaseError("operationId must be 16 to 64 url-safe characters", 400);
  }
  const row = await tx.managerLeaseOperation.findUnique({
    where: { agentId_operationId: { agentId: input.agentId, operationId: input.operationId } },
  });
  if (!row) return null;
  return { action: row.action, expiresAt: row.expiresAt };
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
  input: { agentId: string; action: ManagerLeaseAction; operationId: string; session?: string; grantHash?: string; ttlMinutes?: number; now?: Date },
): Promise<{ expiresAt: Date | null }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(CAST(${MANAGER_LEASE_LOCK_NAMESPACE} AS integer), 0)`;
  const now = input.now ?? new Date();
  if (!OPERATION_ID.test(input.operationId)) {
    throw new ManagerLeaseError("operationId must be 16 to 64 url-safe characters", 400);
  }
  if (!input.grantHash || !GRANT_HASH.test(input.grantHash)) {
    throw new ManagerLeaseError("grantHash must be 64 hex characters", 400);
  }
  const grantHash = input.grantHash;
  const prior = await tx.managerLeaseOperation.findUnique({
    where: { agentId_operationId: { agentId: input.agentId, operationId: input.operationId } },
  });
  if (prior) {
    if (prior.action !== input.action || prior.grantHash !== grantHash) {
      throw new ManagerLeaseError("operation id already confirmed a different change", 409);
    }
    return { expiresAt: prior.expiresAt };
  }

  if (input.action === "take") {
    const ttl = input.ttlMinutes;
    if (!input.session || input.session.length > 100 || !Number.isInteger(ttl) || (ttl as number) < 1 || (ttl as number) > MANAGER_LEASE_MAX_TTL_MINUTES) {
      throw new ManagerLeaseError("take needs session, grantHash (64 hex) and ttlMinutes (1 to 240)", 400);
    }
    const same = await tx.managerLeaseGrant.findUnique({ where: { tokenHash: grantHash } });
    if (same) {
      if (same.agentId !== input.agentId || !live(same, now)) throw denied();
      await remember(tx, { agentId: input.agentId, operationId: input.operationId, action: input.action, grantHash, expiresAt: same.expiresAt });
      return { expiresAt: same.expiresAt };
    }
    const holder = await tx.managerLeaseGrant.findFirst({
      where: { releasedAt: null, replacedAt: null, expiresAt: { gt: now } },
      select: { session: true },
    });
    if (holder) throw new ManagerLeaseError(`manager lease held by ${holder.session}`, 409);
    await tx.managerLeaseGrant.updateMany({
      where: { releasedAt: null, replacedAt: null },
      data: { replacedAt: now },
    });
    const expiresAt = new Date(now.getTime() + (ttl as number) * 60_000);
    await tx.managerLeaseGrant.create({
      data: { agentId: input.agentId, session: input.session, tokenHash: grantHash, ttlMinutes: ttl as number, expiresAt },
    });
    await remember(tx, { agentId: input.agentId, operationId: input.operationId, action: input.action, grantHash, expiresAt });
    return { expiresAt };
  }

  await tx.$queryRaw`SELECT id FROM "ManagerLeaseGrant" WHERE "tokenHash" = ${grantHash} FOR UPDATE`;
  const row = await tx.managerLeaseGrant.findUnique({ where: { tokenHash: grantHash } });
  if (!row || row.agentId !== input.agentId || row.replacedAt) throw denied();
  if (row.releasedAt) {
    if (input.action === "renew") throw denied();
    if (row.endedReason !== input.action) {
      throw new ManagerLeaseError("grant already ended by a different action", 409);
    }
    await remember(tx, { agentId: input.agentId, operationId: input.operationId, action: input.action, grantHash, expiresAt: null });
    return { expiresAt: null };
  }
  if (row.expiresAt.getTime() <= now.getTime()) throw denied();
  if (input.action === "renew") {
    const expiresAt = new Date(now.getTime() + row.ttlMinutes * 60_000);
    await tx.managerLeaseGrant.update({ where: { tokenHash: grantHash }, data: { expiresAt, renewedAt: now } });
    await remember(tx, { agentId: input.agentId, operationId: input.operationId, action: input.action, grantHash, expiresAt });
    return { expiresAt };
  }
  await tx.managerLeaseGrant.update({ where: { tokenHash: grantHash }, data: { releasedAt: now, endedReason: input.action } });
  await remember(tx, { agentId: input.agentId, operationId: input.operationId, action: input.action, grantHash, expiresAt: null });
  return { expiresAt: null };
}
