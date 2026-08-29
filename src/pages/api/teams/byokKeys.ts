import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { decryptByokSecret, encryptByokSecret } from "@/lib/crypto/byokCipher";
import { maskByokSecret } from "@/lib/crypto/maskByokSecret";
import {
  BYOK_PROVIDER_KEYS,
  isByokProviderKey,
  isByokProviderRestrictedInGdprSafeMode,
  isGdprSafeModeEnabled,
  type TByokProviderKey,
} from "@/lib/aiProviders";
import { assertUserCanManageTeamByok } from "@/utils/controllers/teams/assertTeamByokAccess";
import { isPaidTeam } from "@/lib/freeTier";
import { withLockedTeamAiSettings } from "@/utils/controllers/teams/updateTeamAiSettingsAtomically";
import type { Prisma } from "@prisma/client";
import {
  normalizeCustomEndpointBaseUrl,
  normalizeCustomEndpointConfig,
  normalizeCustomEndpointModelId,
  parseCustomEndpointConfig,
  serializeCustomEndpointConfig,
} from "@/lib/ai/customEndpoint";

type CookieUser = { id: number; accountId?: string };

class GdprSafeModeByokError extends Error {}

async function mutateByokWithSafeModeLock(
  teamId: string,
  provider: TByokProviderKey,
  allowWhileSafe: boolean,
  mutate: (
    transaction: Prisma.TransactionClient,
    currentSettings: unknown,
  ) => Promise<unknown>,
) {
  return withLockedTeamAiSettings(
    teamId,
    async (transaction, currentSettings) => {
      if (
        !allowWhileSafe &&
        isByokProviderRestrictedInGdprSafeMode(provider) &&
        isGdprSafeModeEnabled(currentSettings)
      ) {
        throw new GdprSafeModeByokError(
          "Turn off GDPR safe mode before using this provider",
        );
      }
      await mutate(transaction, currentSettings);
      return true;
    },
  );
}

function parseUser(req: NextApiRequest): CookieUser | null {
  try {
    const raw = req.cookies?.nookies_user;
    if (!raw) return null;
    const u = JSON.parse(raw) as { id?: number; accountId?: string };
    if (typeof u?.id !== "number") return null;
    return { id: u.id, accountId: u.accountId };
  } catch {
    return null;
  }
}

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  const user = parseUser(req);
  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.method === "GET") {
    const teamId =
      typeof req.query.teamId === "string" ? req.query.teamId.trim() : "";
    if (!teamId) {
      return res.status(400).json({ message: "teamId required" });
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        googleAccount: { select: { userId: true } },
        googleAccountId: true,
        members: {
          where: { userId: user.id, status: "Accepted" },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!team) return res.status(404).json({ message: "Team not found" });

    const canView =
      team.googleAccount.userId === user.id ||
      Boolean(user.accountId && user.accountId === team.googleAccountId) ||
      team.members.length > 0;
    if (!canView) return res.status(403).json({ message: "Forbidden" });

    const snapshot = await withLockedTeamAiSettings(
      teamId,
      async (transaction, aiProviderSettings) => ({
        aiProviderSettings,
        rows: await transaction.teamByokApiKey.findMany({
          where: { teamId },
          select: { provider: true, enabled: true, ciphertext: true },
        }),
      }),
    );
    if (!snapshot) return res.status(404).json({ message: "Team not found" });

    const map = Object.fromEntries(
      snapshot.rows.map((r) => [
        r.provider,
        {
          enabled: r.enabled,
          ciphertext: r.ciphertext,
        },
      ]),
    );

    const visibleProviders = BYOK_PROVIDER_KEYS.filter(
      (provider) =>
        !isGdprSafeModeEnabled(snapshot.aiProviderSettings) ||
        !isByokProviderRestrictedInGdprSafeMode(provider),
    );
    const keys = visibleProviders.map((provider) => {
      const row = map[provider];
      const ciphertext = row?.ciphertext?.trim() ?? "";
      const hasSecret = ciphertext.length > 0;
      let maskedKey: string | null = null;
      let baseUrl: string | null = null;
      let gdprCompliant = false;
      let modelId: string | null = null;
      if (hasSecret) {
        try {
          const decrypted = decryptByokSecret(ciphertext);
          if (provider === "custom") {
            const config = parseCustomEndpointConfig(decrypted);
            if (config) {
              maskedKey = maskByokSecret(config.apiKey);
              baseUrl = config.baseUrl;
              gdprCompliant = config.gdprCompliant === true;
              modelId = config.modelId;
            }
          } else {
            maskedKey = maskByokSecret(decrypted);
          }
        } catch (e) {
          console.error(
            `[byokKeys] decrypt failed for provider=${provider}`,
            e,
          );
        }
      }
      return {
        provider,
        enabled: row?.enabled ?? false,
        hasSecret,
        maskedKey,
        ...(provider === "custom"
          ? { baseUrl, gdprCompliant, modelId }
          : {}),
      };
    });

    return res.status(200).json({
      gdprSafeMode: isGdprSafeModeEnabled(snapshot.aiProviderSettings),
      keys,
    });
  }

  if (req.method === "POST") {
    const {
      teamId,
      provider,
      enabled,
      apiKey,
      baseUrl,
      gdprCompliant,
      modelId,
      clearSecret,
    } = req.body as {
        teamId?: string;
        provider?: string;
        enabled?: boolean;
        apiKey?: string;
        baseUrl?: string;
        gdprCompliant?: boolean;
        modelId?: string;
        clearSecret?: boolean;
      };

    if (!teamId || typeof teamId !== "string") {
      return res.status(400).json({ message: "teamId required" });
    }
    if (!isByokProviderKey(provider)) {
      return res.status(400).json({ message: "Invalid provider" });
    }

    const gate = await assertUserCanManageTeamByok(
      user.id,
      user.accountId,
      teamId,
    );
    if (!gate.ok) {
      return res.status(gate.status).json({ message: gate.message });
    }

    // Branch 1: delete key row
    if (clearSecret === true) {
      try {
        await mutateByokWithSafeModeLock(
          teamId,
          provider,
          true,
          (transaction) =>
            transaction.teamByokApiKey.deleteMany({
              where: { teamId, provider },
            }),
        );
        return res.status(200).json({ ok: true });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ message: "Delete failed" });
      }
    }

    // HTPR-4839: BYOK is a paid feature. Reads and the delete above stay open so
    // a downgraded team can still see and remove the key it already stored.
    if (!(await isPaidTeam(teamId))) {
      return res.status(402).json({
        message: "Adding your own API key requires a paid plan.",
        code: "UPGRADE_REQUIRED",
      });
    }

    // Branch 2: custom OpenAI-compatible endpoint. The existing ciphertext column
    // stores one encrypted, versioned payload so the key and routing metadata remain
    // atomic without a schema change.
    if (
      provider === "custom" &&
      (apiKey || baseUrl || modelId || typeof gdprCompliant === "boolean")
    ) {
      try {
        await mutateByokWithSafeModeLock(
          teamId,
          provider,
          false,
          async (transaction, currentSettings) => {
            const existing = await transaction.teamByokApiKey.findUnique({
              where: { teamId_provider: { teamId, provider } },
              select: { ciphertext: true },
            });
            const existingConfig = existing?.ciphertext
              ? parseCustomEndpointConfig(
                  decryptByokSecret(existing.ciphertext),
                )
              : null;
            const config = normalizeCustomEndpointConfig({
              apiKey:
                typeof apiKey === "string" && apiKey.trim()
                  ? apiKey
                  : existingConfig?.apiKey,
              baseUrl: normalizeCustomEndpointBaseUrl(baseUrl),
              gdprCompliant:
                typeof gdprCompliant === "boolean"
                  ? gdprCompliant
                  : existingConfig?.gdprCompliant,
              modelId: normalizeCustomEndpointModelId(modelId),
            });
            if (
              isGdprSafeModeEnabled(currentSettings) &&
              !config.gdprCompliant
            ) {
              throw new GdprSafeModeByokError(
                "Confirm the custom endpoint operates under an EU/US data agreement before using it in GDPR safe mode",
              );
            }
            const ciphertext = encryptByokSecret(
              serializeCustomEndpointConfig(config),
            );
            await transaction.teamByokApiKey.upsert({
              where: { teamId_provider: { teamId, provider } },
              create: {
                teamId,
                provider,
                ciphertext,
                enabled: enabled ?? true,
              },
              update: {
                ciphertext,
                enabled: typeof enabled === "boolean" ? enabled : true,
              },
            });
          },
        );
        return res.status(200).json({ ok: true });
      } catch (e) {
        if (e instanceof GdprSafeModeByokError) {
          return res.status(400).json({ message: e.message });
        }
        const message = e instanceof Error ? e.message : "Save failed";
        if (message.includes("BYOK_CIPHER_SECRET")) {
          return res
            .status(500)
            .json({ message: "Server encryption not configured" });
        }
        if (
          message.includes("required") ||
          message.includes("public HTTP(S)")
        ) {
          return res.status(400).json({ message });
        }
        console.error("[byokKeys] custom endpoint save failed");
        return res.status(500).json({ message: "Save failed" });
      }
    }

    // Branch 3: new/replacement API key — encrypt and save; auto-enable on first create
    const hasKeyPayload =
      typeof apiKey === "string" && apiKey.trim().length > 0;
    if (hasKeyPayload) {
      if (provider === "gateway" && !apiKey.trim().startsWith("vck_")) {
        return res
          .status(400)
          .json({ message: "Gateway keys must start with vck_" });
      }
      try {
        const ciphertext = encryptByokSecret(apiKey.trim());
        await mutateByokWithSafeModeLock(
          teamId,
          provider,
          false,
          (transaction) =>
            transaction.teamByokApiKey.upsert({
              where: {
                teamId_provider: {
                  teamId,
                  provider,
                },
              },
              create: {
                teamId,
                provider,
                ciphertext,
                enabled: enabled ?? true,
              },
              update: {
                ciphertext,
                ...(typeof enabled === "boolean" ? { enabled } : {}),
              },
            }),
        );
        return res.status(200).json({ ok: true });
      } catch (e) {
        if (e instanceof GdprSafeModeByokError) {
          return res.status(400).json({ message: e.message });
        }
        const msg = e instanceof Error ? e.message : "Save failed";
        if (msg.includes("BYOK_CIPHER_SECRET")) {
          return res
            .status(500)
            .json({ message: "Server encryption not configured" });
        }
        console.error(`[byokKeys] save failed for provider=${provider}`);
        return res.status(500).json({ message: "Save failed" });
      }
    }

    // Branch 4: toggle enabled only
    if (typeof enabled === "boolean") {
      try {
        await mutateByokWithSafeModeLock(
          teamId,
          provider,
          enabled === false,
          async (transaction, currentSettings) => {
            if (
              provider === "custom" &&
              enabled &&
              isGdprSafeModeEnabled(currentSettings)
            ) {
              const existing = await transaction.teamByokApiKey.findUnique({
                where: { teamId_provider: { teamId, provider } },
                select: { ciphertext: true },
              });
              const config = existing?.ciphertext
                ? parseCustomEndpointConfig(
                    decryptByokSecret(existing.ciphertext),
                  )
                : null;
              if (!config?.gdprCompliant) {
                throw new GdprSafeModeByokError(
                  "Confirm the custom endpoint operates under an EU/US data agreement before using it in GDPR safe mode",
                );
              }
            }
            return transaction.teamByokApiKey.upsert({
              where: { teamId_provider: { teamId, provider } },
              create: { teamId, provider, enabled, ciphertext: "" },
              update: { enabled },
            });
          },
        );
        return res.status(200).json({ ok: true });
      } catch (e) {
        if (e instanceof GdprSafeModeByokError) {
          return res.status(400).json({ message: e.message });
        }
        console.error(e);
        return res.status(500).json({ message: "Save failed" });
      }
    }

    return res.status(400).json({
      message: "apiKey, clearSecret, or enabled boolean required",
    });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ message: "Method not allowed" });
};

export default handler;
