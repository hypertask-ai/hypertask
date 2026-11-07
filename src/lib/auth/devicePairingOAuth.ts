import type { OAuthAuthorizationCode, Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto/byokCipher";
import {
  approveDevicePairing, DEVICE_DELIVERY_RETRY_MS, deviceHash, deviceSecretSchema, DevicePairingError,
  ownedDevicePairing, requireDevicePairingEnabled,
} from "./devicePairing";

type PairedGrant = Pick<OAuthAuthorizationCode, "code" | "user_id" | "agent_id" | "devicePairingId" | "client_id" | "redirect_uri" | "code_challenge">;

export async function pendingBrowserDevicePairing(ownerId: number, browserSecret: string) {
  if (!deviceSecretSchema.safeParse(browserSecret).success) return null;
  try {
    await requireDevicePairingEnabled(ownerId);
    return await prisma.devicePairing.findFirst({
      where: { ownerId, browserHash: deviceHash(browserSecret), state: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
  } catch {
    return null;
  }
}

export async function approveOAuthDevicePairing(input: {
  ownerId: number; browserSecret: string; flowId: string; clientId: string;
  redirectUri: string; challenge: string; clientName: string;
}) {
  if (!deviceSecretSchema.safeParse(input.challenge).success) throw new DevicePairingError("invalid_grant");
  const flow = await ownedDevicePairing(input.ownerId, input.browserSecret, input.flowId);
  if (flow.expiresAt <= new Date()) throw new DevicePairingError("expired_token");
  const changed = await prisma.devicePairing.updateMany({
    where: { id: flow.id, state: "PENDING", expiresAt: { gt: new Date() } },
    data: {
      state: "CLAIMED", challenge: input.challenge, oauthClientId: input.clientId,
      oauthRedirectUri: input.redirectUri,
      clientName: input.clientName.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 60) || "MCP client",
    },
  });
  if (changed.count !== 1 && (flow.oauthClientId !== input.clientId || flow.oauthRedirectUri !== input.redirectUri || flow.challenge !== input.challenge)) {
    throw new DevicePairingError("invalid_grant");
  }
  await approveDevicePairing(input.ownerId, input.browserSecret, flow.id);
  const approved = await ownedDevicePairing(input.ownerId, input.browserSecret, flow.id);
  if (!approved.agentId || approved.state !== "APPROVED") throw new DevicePairingError("invalid_grant");
  return approved;
}

export async function deliverDeviceOAuthCredential(tx: Prisma.TransactionClient, grant: PairedGrant, generation: string, accessToken: string) {
  if (!grant.devicePairingId || !grant.agent_id) throw new DevicePairingError("invalid_grant");
  await requireDevicePairingEnabled(grant.user_id);
  const now = new Date();
  const flow = await tx.devicePairing.findUnique({ where: { id: grant.devicePairingId } });
  if (!flow || flow.expiresAt <= now) throw new DevicePairingError("expired_token");
  const changed = await tx.devicePairing.updateMany({
    where: {
      id: grant.devicePairingId, ownerId: grant.user_id, agentId: grant.agent_id, tokenGeneration: generation,
      state: "APPROVED", expiresAt: { gt: now }, oauthClientId: grant.client_id,
      oauthRedirectUri: grant.redirect_uri, challenge: grant.code_challenge,
    },
    data: {
      state: "DELIVERED", credential: null, deliveryResult: encryptSecret(accessToken),
      oauthCodeHash: deviceHash(grant.code), deliveryRetryUntil: new Date(Math.min(flow.expiresAt.getTime(), now.getTime() + DEVICE_DELIVERY_RETRY_MS)),
    },
  });
  if (changed.count !== 1) throw new DevicePairingError("invalid_grant");
}

export async function replayDeviceOAuthCredential(grant: PairedGrant, generation: string) {
  await requireDevicePairingEnabled(grant.user_id);
  const flow = await prisma.devicePairing.findFirst({
    where: {
      id: grant.devicePairingId ?? "", ownerId: grant.user_id, agentId: grant.agent_id,
      state: "DELIVERED", tokenGeneration: generation, oauthClientId: grant.client_id,
      oauthRedirectUri: grant.redirect_uri, challenge: grant.code_challenge, oauthCodeHash: deviceHash(grant.code),
      expiresAt: { gt: new Date() }, deliveryRetryUntil: { gt: new Date() },
    },
  });
  if (!flow?.deliveryResult) throw new DevicePairingError("invalid_grant");
  return z.string().min(1).parse(decryptSecret(flow.deliveryResult));
}
