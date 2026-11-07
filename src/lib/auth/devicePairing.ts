import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma, type DevicePairing } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG } from "@/lib/flags/definitions/htpr-6542-team-scoped-management-keys";
import { HTPR_7552_AGENT_CODE_SIGNIN_FLAG } from "@/lib/flags/definitions/htpr-7552-agent-code-signin";
import { getManagementKeyTeam } from "@/lib/mcp/managementKeyTeamScope";
import { encryptSecret, decryptSecret } from "@/lib/crypto/byokCipher";
import { agentTokenCredentialFields, createMcpToken, verifyMcpJwtToken, MCP_TOKEN_ISSUED_AT_MS_CLAIM } from "@/lib/mcp/auth/verifyJwt";
import { enqueueBoardCreated, processAnalyticsIntentSoon } from "@/lib/telemetry/savedWork";
import { starterBoardSections } from "@/utils/controllers/projects/create";
import { createProjectWithStableName } from "@/utils/controllers/projects/createProjectWithStableName";
import { createProjectViewAndCreateDefault } from "@/utils/controllers/projects/create";

export { DEVICE_PAIRING_COOKIE } from "./devicePairingCookie";
export const DEVICE_PAIRING_SECONDS = 300;
export const DEVICE_DELIVERY_RETRY_MS = 60_000;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const deviceSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const deviceVerifierSchema = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
export const deviceCodeSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
export const deviceClientNameSchema = z.string().trim().min(1).max(60).regex(/^[^\u0000-\u001f\u007f-\u009f]+$/);

export class DevicePairingError extends Error {
  constructor(readonly code: "invalid_grant" | "access_denied" | "expired_token" | "authorization_pending", readonly status = 400) {
    super(code);
  }
}

export function deviceHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function deviceChallenge(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function equal(left: string | null, right: string): boolean {
  return left !== null && left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export async function requireDevicePairingEnabled(ownerId: number): Promise<void> {
  if (!await isFeatureEnabled(HTPR_7552_AGENT_CODE_SIGNIN_FLAG, ownerId)) {
    throw new DevicePairingError("access_denied", 403);
  }
}

function assertUnexpired(flow: DevicePairing, now: Date): void {
  if (flow.expiresAt <= now) throw new DevicePairingError("expired_token");
  if (flow.state === "DENIED") throw new DevicePairingError("access_denied", 403);
}

export async function startDevicePairing(ownerId: number, browserSecret: string) {
  await requireDevicePairingEnabled(ownerId);
  const bytes = randomBytes(8);
  const rawCode = Array.from(bytes, byte => ALPHABET[byte & 31]).join("");
  const code = `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`;
  const flow = await prisma.devicePairing.create({
    data: {
      ownerId,
      browserHash: deviceHash(browserSecret),
      codeHash: deviceHash(code),
      expiresAt: new Date(Date.now() + DEVICE_PAIRING_SECONDS * 1000),
    },
    select: { id: true, expiresAt: true },
  });
  return { id: flow.id, code, expiresAt: flow.expiresAt, interval: 5 };
}

export async function ownedDevicePairing(ownerId: number, browserSecret: string, flowId: string) {
  const flow = await prisma.devicePairing.findFirst({
    where: { id: flowId, ownerId, browserHash: deviceHash(browserSecret) },
  });
  if (!flow) throw new DevicePairingError("invalid_grant");
  await requireDevicePairingEnabled(flow.ownerId);
  return flow;
}

export function devicePairingStatus(flow: DevicePairing) {
  const state = flow.expiresAt <= new Date() && ["PENDING", "CLAIMED", "APPROVED"].includes(flow.state) ? "EXPIRED" : flow.state;
  return {
    id: flow.id,
    state,
    expiresAt: flow.expiresAt,
    clientName: flow.clientName,
    ...(state === "CONNECTED" && flow.projectId ? { boardUrl: `/projects/project-${flow.projectId}` } : {}),
  };
}

type ClaimInput = {
  code: string;
  challenge: string;
  claimant: string;
  clientName: string;
  verifier?: string;
};

export async function claimDevicePairing(input: ClaimInput) {
  const flow = await prisma.devicePairing.findUnique({ where: { codeHash: deviceHash(input.code) } });
  if (!flow) throw new DevicePairingError("invalid_grant");
  await requireDevicePairingEnabled(flow.ownerId);
  assertUnexpired(flow, new Date());
  const claimantHash = deviceHash(input.claimant);
  if (flow.state !== "PENDING") {
    if (flow.oauthClientId || !equal(flow.claimantHash, claimantHash) || !input.verifier ||
      !equal(flow.challenge, deviceChallenge(input.verifier)) || flow.challenge !== input.challenge) {
      throw new DevicePairingError("invalid_grant");
    }
    return { id: flow.id, interval: 5, expiresAt: flow.expiresAt };
  }
  const changed = await prisma.devicePairing.updateMany({
    where: { id: flow.id, state: "PENDING", expiresAt: { gt: new Date() } },
    data: { state: "CLAIMED", challenge: input.challenge, claimantHash, clientName: input.clientName },
  });
  if (changed.count !== 1) throw new DevicePairingError("invalid_grant");
  return { id: flow.id, interval: 5, expiresAt: flow.expiresAt };
}

export async function approveDevicePairing(ownerId: number, browserSecret: string, flowId: string) {
  const existing = await ownedDevicePairing(ownerId, browserSecret, flowId);
  assertUnexpired(existing, new Date());
  if (["APPROVED", "DELIVERED", "CONNECTED"].includes(existing.state)) return devicePairingStatus(existing);
  if (existing.state !== "CLAIMED") throw new DevicePairingError("invalid_grant");
  const flow = await prisma.$transaction(async tx => {
    const now = new Date();
    const claimed = await tx.devicePairing.updateMany({
      where: { id: flowId, ownerId, browserHash: deviceHash(browserSecret), state: "CLAIMED", expiresAt: { gt: now } },
      data: { state: "APPROVED" },
    });
    if (claimed.count !== 1) throw new DevicePairingError("invalid_grant");
    await requireDevicePairingEnabled(ownerId);
    if (!await isFeatureEnabled(HTPR_6542_TEAM_SCOPED_MANAGEMENT_KEYS_FLAG, ownerId)) {
      throw new DevicePairingError("access_denied", 403);
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: ownerId }, select: { id: true, email: true, stripe_customer_id: true } });
    const account = await tx.googleAccount.findFirst({ where: { userId: ownerId } }) ??
      await tx.googleAccount.create({ data: { userId: ownerId, stripe_customer_id: user.stripe_customer_id ?? "" } });
    const team = await tx.team.create({
      data: { title: "MyTeam", googleAccountId: account.id, totalSeats: 1, team_activity: { create: { lastActiviyAt: now } } },
    });
    const grant = await getManagementKeyTeam(ownerId, team.id, tx as unknown as Pick<typeof prisma, "team">);
    if (!grant) throw new DevicePairingError("access_denied", 403);
    const teamScope = { teamId: grant.id, accessBinding: grant.accessBinding };
    const board = await createProjectWithStableName({
      ownerId, title: "MyBoard", googleAccountId: account.id, teamId: team.id, uniqueIdentifier: "AGENT",
      section: starterBoardSections(),
    }, { actorUserId: ownerId, entryPoint: "cli.device.approve" }, tx);
    const analyticsKey = await enqueueBoardCreated(tx, board.id, "manual", { userId: ownerId });
    await createProjectViewAndCreateDefault({ userId: ownerId, projectId: board.id }, tx);
    const agent = await tx.agent.create({
      data: {
        devicePairingId: flowId, userId: ownerId, displayName: existing.clientName ?? "Connected agent", permissions: { role: "write" },
        boardHomeTeamId: team.id, crossTeamHomeTeamId: team.id, crossTeamAccessGranted: false,
        credentialTeamId: teamScope.teamId, credentialTeamAccessBinding: teamScope.accessBinding,
        members: { create: { userId: ownerId, projectId: board.id, status: "Accepted" } },
      },
      select: { id: true },
    });
    const credential = createMcpToken(ownerId, user.email, undefined, agent.id, teamScope);
    const fields = agentTokenCredentialFields(credential);
    await tx.agent.update({ where: { id: agent.id }, data: { ...fields, mcpTokenExpiresAt: null } });
    await tx.user_Activity.updateMany({ where: { userId: ownerId }, data: { totalTeamsOwned: { increment: 1 } } });
    const updated = await tx.devicePairing.update({
      where: { id: flowId },
      data: { agentId: agent.id, teamId: team.id, projectId: board.id, tokenGeneration: fields.mcpTokenJti, credential: encryptSecret(credential) },
    });
    assertUnexpired(updated, new Date());
    return { updated, analyticsKey };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  processAnalyticsIntentSoon(flow.analyticsKey);
  return devicePairingStatus(flow.updated);
}

export async function denyDevicePairing(ownerId: number, browserSecret: string, flowId: string) {
  await ownedDevicePairing(ownerId, browserSecret, flowId);
  await prisma.$transaction(async tx => {
    const updated = await tx.devicePairing.updateMany({
      where: { id: flowId, ownerId, browserHash: deviceHash(browserSecret), state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
      data: { state: "DENIED", credential: null, deliveryResult: null },
    });
    if (updated.count !== 1) throw new DevicePairingError("invalid_grant");
    const flow = await tx.devicePairing.findUniqueOrThrow({ where: { id: flowId } });
    if (flow.agentId) await tx.agent.update({ where: { id: flow.agentId }, data: { ...agentTokenCredentialFields(null), revokedAt: new Date() } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { state: "DENIED" };
}

export async function claimantDevicePairing(flowId: string, claimant: string, verifier: string) {
  const flow = await prisma.devicePairing.findUnique({ where: { id: flowId } });
  if (!flow || flow.oauthClientId || !equal(flow.claimantHash, deviceHash(claimant)) || !equal(flow.challenge, deviceChallenge(verifier))) {
    throw new DevicePairingError("invalid_grant");
  }
  await requireDevicePairingEnabled(flow.ownerId);
  assertUnexpired(flow, new Date());
  return flow;
}

export async function deliverDeviceCredential(flowId: string, claimant: string, verifier: string) {
  const existing = await claimantDevicePairing(flowId, claimant, verifier);
  if (existing.state === "CLAIMED") throw new DevicePairingError("authorization_pending");
  return prisma.$transaction(async tx => {
    const flow = await tx.devicePairing.findUniqueOrThrow({ where: { id: flowId } });
    assertUnexpired(flow, new Date());
    await requireDevicePairingEnabled(flow.ownerId);
    if (!flow.agentId || !flow.tokenGeneration || !await tx.agent.findFirst({
      where: { id: flow.agentId, userId: flow.ownerId, revokedAt: null, mcpTokenJti: flow.tokenGeneration }, select: { id: true },
    })) throw new DevicePairingError("access_denied", 403);
    if (flow.state === "DELIVERED" && flow.deliveryRetryUntil && flow.deliveryRetryUntil > new Date() && flow.deliveryResult) {
      return { token: decryptSecret(flow.deliveryResult), boardUrl: `https://app.hypertask.ai/projects/project-${flow.projectId}` };
    }
    if (flow.state !== "APPROVED" || !flow.credential) throw new DevicePairingError("invalid_grant");
    const token = decryptSecret(flow.credential);
    const claims = verifyMcpJwtToken(token, { boundedLogging: true });
    const issuedAt = claims?.[MCP_TOKEN_ISSUED_AT_MS_CLAIM];
    const user = await tx.user.findUnique({ where: { id: flow.ownerId }, select: { mcpTokensRevokedAt: true } });
    if (!user || typeof issuedAt !== "number" || user.mcpTokensRevokedAt && issuedAt < user.mcpTokensRevokedAt.getTime()) {
      throw new DevicePairingError("access_denied", 403);
    }
    const changed = await tx.devicePairing.updateMany({
      where: { id: flowId, state: "APPROVED", expiresAt: { gt: new Date() } },
      data: { state: "DELIVERED", credential: null, deliveryResult: flow.credential, deliveryRetryUntil: new Date(Math.min(flow.expiresAt.getTime(), Date.now() + DEVICE_DELIVERY_RETRY_MS)) },
    });
    if (changed.count !== 1) throw new DevicePairingError("invalid_grant");
    return { token, boardUrl: `https://app.hypertask.ai/projects/project-${flow.projectId}` };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function acknowledgeDevicePairing(agentId: string, generation: string) {
  await prisma.$transaction(async tx => {
    const changed = await tx.devicePairing.updateMany({
      where: { agentId, tokenGeneration: generation, state: "DELIVERED" },
      data: { state: "CONNECTED", credential: null, deliveryResult: null, deliveryRetryUntil: null },
    });
    if (changed.count === 1) await tx.agent.updateMany({
      where: { id: agentId, mcpTokenJti: generation }, data: { devicePairingId: null },
    });
  });
}
