import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7949_MANAGED_AI_KEY_PROVISIONING_FLAG } from "@/lib/flags/definitions/htpr-7949-managed-ai-key-provisioning";
import { encryptByokSecret } from "@/lib/crypto/byokCipher";
import { MANAGED_TEAM_GATEWAY_PROVIDER } from "@/app/api/ai/_lib/managedGatewayKeys";
import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";

export async function ensureManagedTeamGatewayKeyWithTeamLockHeld(
  teamId: string,
  assertHeld: () => void,
  options: { dryRun?: boolean } = {},
) {
  assertHeld();
  const plan = await storePlanIdForProject(null, teamId);
  if (plan !== "Pro" && plan !== "AI") return "ineligible";

  const where = {
    teamId_provider: { teamId, provider: MANAGED_TEAM_GATEWAY_PROVIDER },
  };
  const existing = await prisma.teamByokApiKey.findUnique({
    where,
    select: { ciphertext: true },
  });
  if (existing) return "existing";
  if (options.dryRun) return "missing";

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { googleAccount: { select: { userId: true } } },
  });
  if (!team || !(await isFeatureEnabled(
    HTPR_7949_MANAGED_AI_KEY_PROVISIONING_FLAG,
    team.googleAccount.userId,
  ))) return "disabled";

  const token = process.env.MANAGED_GATEWAY_VERCEL_TOKEN?.trim();
  const vercelTeamId = process.env.MANAGED_GATEWAY_VERCEL_TEAM_ID?.trim();
  if (!token || !vercelTeamId || (process.env.BYOK_CIPHER_SECRET?.length ?? 0) < 16) {
    throw new Error("Missing managed gateway provisioning configuration");
  }

  const url = new URL("https://api.vercel.com/v1/api-keys");
  url.searchParams.set("teamId", vercelTeamId);
  assertHeld();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      purpose: "ai-gateway",
      name: `Hypertask team ${teamId}`,
      metadata: { spendAttribution: "team" },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Managed gateway key creation failed (HTTP ${response.status})`);
  }
  const result = await response.json();
  const apiKey = result?.apiKeyString;
  if (typeof apiKey !== "string" || !apiKey.startsWith("vck_")) {
    throw new Error("Invalid managed gateway key creation response");
  }

  const ciphertext = encryptByokSecret(apiKey);
  assertHeld();
  const stored = await prisma.teamByokApiKey.upsert({
    where,
    create: {
      teamId,
      provider: MANAGED_TEAM_GATEWAY_PROVIDER,
      ciphertext,
      enabled: true,
    },
    update: {},
    select: { ciphertext: true },
  });
  return stored.ciphertext === ciphertext ? "created" : "existing";
}
