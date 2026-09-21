import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import {
  AI_PROVIDERS,
  enabledProvidersForTeam,
  getAiProviderInfo,
  getActiveGdprProviderTestLease,
  isAiProviderKey,
  isGdprSafeModeEnabled,
  resolveTeamProviderEnabled,
  type TAiProviderKey,
} from "@/lib/aiProviders";
import { assertUserCanManageTeamByok } from "@/utils/controllers/teams/assertTeamByokAccess";
import { getTeamAiSettingsForViewer } from "@/utils/controllers/teams/getTeamAiSettingsForViewer";
import { updateTeamAiSettingsAtomically } from "@/utils/controllers/teams/updateTeamAiSettingsAtomically";

type CookieUser = { id: number; accountId?: string };

class ProviderSettingsError extends Error {}

function parseUser(req: NextApiRequest): CookieUser | null {
  try {
    const raw = req.cookies?.nookies_user;
    if (!raw) return null;
    const user = JSON.parse(raw) as { id?: number; accountId?: string };
    if (typeof user.id !== "number") return null;
    return { id: user.id, accountId: user.accountId };
  } catch {
    return null;
  }
}

function providerRows(settings: unknown) {
  return AI_PROVIDERS.filter(
    (provider) => !isGdprSafeModeEnabled(settings) || !provider.chinaHosted,
  ).map((provider) => ({
    key: provider.key,
    label: provider.label,
    chinaHosted: provider.chinaHosted,
    gdprNote: provider.gdprNote,
    enabled: resolveTeamProviderEnabled(settings, provider.key),
  }));
}

function currentProviderOverrides(settings: unknown) {
  if (!settings || Array.isArray(settings) || typeof settings !== "object") {
    return {} as Partial<Record<TAiProviderKey, boolean>>;
  }

  const providers = (settings as { providers?: unknown }).providers;
  const source =
    providers && !Array.isArray(providers) && typeof providers === "object"
      ? (providers as Record<string, unknown>)
      : (settings as Record<string, unknown>);

  return Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) => isAiProviderKey(key) && typeof value === "boolean",
    ),
  ) as Partial<Record<TAiProviderKey, boolean>>;
}

function currentSettings(settings: unknown): Record<string, unknown> {
  if (!settings || Array.isArray(settings) || typeof settings !== "object") {
    return {};
  }

  return settings as Record<string, unknown>;
}

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  const user = parseUser(req);
  if (!user) return res.status(401).json({ message: "Unauthorized" });

  if (req.method === "GET") {
    const teamId =
      typeof req.query.teamId === "string" ? req.query.teamId.trim() : "";
    if (!teamId) return res.status(400).json({ message: "teamId required" });

    const lookup = await getTeamAiSettingsForViewer(
      user.id,
      user.accountId,
      teamId,
    );
    if (!lookup.ok) {
      return res.status(lookup.status).json({ message: lookup.message });
    }

    return res.status(200).json({
      gdprSafeMode: isGdprSafeModeEnabled(lookup.settings),
      providers: providerRows(lookup.settings),
    });
  }

  if (req.method === "POST") {
    const { teamId, provider, enabled, gdprSafeMode } = req.body as {
      teamId?: string;
      provider?: unknown;
      enabled?: unknown;
      gdprSafeMode?: unknown;
    };

    if (!teamId || typeof teamId !== "string") {
      return res.status(400).json({ message: "teamId required" });
    }
    const updatingSafeMode = typeof gdprSafeMode === "boolean";
    if (!updatingSafeMode) {
      if (!isAiProviderKey(provider)) {
        return res.status(400).json({ message: "Invalid provider" });
      }
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ message: "enabled boolean required" });
      }
    }

    const gate = await assertUserCanManageTeamByok(
      user.id,
      user.accountId,
      teamId,
    );
    if (!gate.ok) {
      return res.status(gate.status).json({ message: gate.message });
    }

    let nextSettings: Record<string, unknown> | null;
    try {
      nextSettings = await updateTeamAiSettingsAtomically(
        teamId,
        (lockedSettings) => {
          if (
            updatingSafeMode &&
            gdprSafeMode === true &&
            getActiveGdprProviderTestLease(lockedSettings)
          ) {
            throw new ProviderSettingsError(
              "Wait for the provider key test to finish before enabling GDPR safe mode",
            );
          }
          if (
            !updatingSafeMode &&
            enabled === true &&
            isGdprSafeModeEnabled(lockedSettings) &&
            isAiProviderKey(provider) &&
            getAiProviderInfo(provider)?.chinaHosted
          ) {
            throw new ProviderSettingsError(
              "Turn off GDPR safe mode before enabling this provider",
            );
          }

          const next = updatingSafeMode
            ? {
                ...currentSettings(lockedSettings),
                gdprSafeMode,
              }
            : {
                ...currentSettings(lockedSettings),
                providers: {
                  ...currentProviderOverrides(lockedSettings),
                  [provider as TAiProviderKey]: enabled as boolean,
                },
              };

          if (enabledProvidersForTeam(next).length === 0) {
            throw new ProviderSettingsError(
              "At least one AI provider must remain enabled",
            );
          }
          return next;
        },
      );
    } catch (error) {
      if (error instanceof ProviderSettingsError) {
        return res.status(400).json({ message: error.message });
      }
      throw error;
    }
    if (!nextSettings) {
      return res.status(404).json({ message: "Team not found" });
    }

    return res.status(200).json({
      gdprSafeMode: isGdprSafeModeEnabled(nextSettings),
      providers: providerRows(nextSettings),
    });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ message: "Method not allowed" });
};

export default handler;
