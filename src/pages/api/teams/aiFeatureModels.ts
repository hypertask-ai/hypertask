import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import {
  AI_FEATURES,
  getAiFeatureModelOverride,
  isAiFeature,
  isAiFeatureEnabled,
  isAiFeatureModelAllowed,
  isAiFeatureModelEnabled,
  resetAiFeatureSettings,
  resolveImageModel,
  resolveSystemModel,
  resolveUserFacingModelOption,
  updateAiFeatureModelSettings,
  updateAiFeatureToggleSettings,
  type AiFeature,
  type ModelAiFeature,
  type SystemFeature,
  type UserFacingModelFeature,
} from "@/lib/systemModelLadder";
import {
  isDictationProvider,
  resolveDictationProvider,
  updateDictationProviderSettings,
} from "@/lib/dictationProvider";
import { assertUserCanManageTeamByok } from "@/utils/controllers/teams/assertTeamByokAccess";
import { getTeamAiSettingsForViewer } from "@/utils/controllers/teams/getTeamAiSettingsForViewer";
import { updateTeamAiSettingsAtomically } from "@/utils/controllers/teams/updateTeamAiSettingsAtomically";
import { resolveTeamCustomEndpoint } from "@/app/api/ai/_lib/byokKeys";
import { getAiModelOptionById } from "@/lib/aiModelOptions";

type CookieUser = { id: number; accountId?: string };

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

function effectiveModel(
  feature: AiFeature,
  settings: unknown,
  customEndpointConfigured: boolean,
): string | null {
  const enabledSettings = updateAiFeatureToggleSettings(
    settings,
    feature,
    true,
  );
  const kind = AI_FEATURES[feature].modelKind;
  if (kind === "none") return null;
  if (kind === "fast") {
    return (
      resolveSystemModel(feature as SystemFeature, enabledSettings)?.model ??
      null
    );
  }
  if (kind === "image") {
    return resolveImageModel(enabledSettings)?.key ?? null;
  }
  return (
    resolveUserFacingModelOption(
      feature as UserFacingModelFeature,
      enabledSettings,
      null,
      { customEndpointConfigured },
    )?.id ?? null
  );
}

function featureRow(
  feature: AiFeature,
  settings: unknown,
  customEndpointConfigured: boolean,
) {
  const kind = AI_FEATURES[feature].modelKind;
  const override =
    kind === "none"
      ? null
      : getAiFeatureModelOverride(feature as ModelAiFeature, settings);

  return {
    enabled: isAiFeatureEnabled(feature, settings),
    model:
      override && isAiFeatureModelAllowed(feature as ModelAiFeature, override)
        ? isAiFeatureModelEnabled(
            feature as ModelAiFeature,
            override,
            settings,
            customEndpointConfigured,
          )
          ? override
          : null
        : null,
    effectiveModel: effectiveModel(
      feature,
      settings,
      customEndpointConfigured,
    ),
    // Dictation has no LLM model, but a swappable transcription provider.
    ...(feature === "dictation"
      ? { provider: resolveDictationProvider(settings) }
      : {}),
  };
}

function featureModelsResponse(
  settings: unknown,
  customEndpointConfigured: boolean,
) {
  return Object.fromEntries(
    (Object.keys(AI_FEATURES) as AiFeature[]).map((feature) => [
      feature,
      featureRow(feature, settings, customEndpointConfigured),
    ]),
  );
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

    const customEndpointConfigured = Boolean(
      await resolveTeamCustomEndpoint({ trustedTeamId: teamId }),
    );
    return res
      .status(200)
      .json(featureModelsResponse(lookup.settings, customEndpointConfigured));
  }

  if (req.method === "POST") {
    const {
      teamId,
      feature,
      model: requestedModel,
      enabled,
      provider,
      reset,
    } = req.body as {
      teamId?: unknown;
      feature?: unknown;
      model?: unknown;
      enabled?: unknown;
      provider?: unknown;
      reset?: unknown;
    };
    const normalizedTeamId = typeof teamId === "string" ? teamId.trim() : "";
    if (!normalizedTeamId) {
      return res.status(400).json({ message: "teamId required" });
    }

    const gate = await assertUserCanManageTeamByok(
      user.id,
      user.accountId,
      normalizedTeamId,
    );
    if (!gate.ok) {
      return res.status(gate.status).json({ message: gate.message });
    }
    const customEndpointConfigured = Boolean(
      await resolveTeamCustomEndpoint({ trustedTeamId: normalizedTeamId }),
    );

    let buildNextSettings: (settings: unknown) => Record<string, unknown>;
    if (reset === true) {
      buildNextSettings = resetAiFeatureSettings;
    } else {
      if (!isAiFeature(feature)) {
        return res.status(400).json({ message: "Invalid feature" });
      }
      const validFeature = feature;

      if (validFeature === "dictation" && provider !== undefined) {
        if (!isDictationProvider(provider)) {
          return res
            .status(400)
            .json({ message: "Invalid dictation provider" });
        }
        const validProvider = provider;
        buildNextSettings = (settings) =>
          updateDictationProviderSettings(settings, validProvider);
      } else if (typeof enabled === "boolean" && requestedModel === undefined) {
        const validEnabled = enabled;
        buildNextSettings = (settings) =>
          updateAiFeatureToggleSettings(settings, validFeature, validEnabled);
      } else {
        if (validFeature === "dictation") {
          return res
            .status(400)
            .json({ message: "Dictation does not use a model" });
        }
        if (requestedModel === undefined) {
          return res.status(400).json({ message: "model required" });
        }

        const normalizedModel =
          typeof requestedModel === "string"
            ? requestedModel.trim()
            : requestedModel;
        if (
          normalizedModel !== null &&
          normalizedModel !== "" &&
          !isAiFeatureModelAllowed(validFeature, normalizedModel)
        ) {
          return res.status(400).json({ message: "Invalid model for feature" });
        }
        if (
          typeof normalizedModel === "string" &&
          getAiModelOptionById(normalizedModel)?.source === "custom" &&
          !customEndpointConfigured
        ) {
          return res.status(400).json({
            message:
              "Configure an available custom endpoint before selecting it",
          });
        }
        buildNextSettings = (settings) =>
          updateAiFeatureModelSettings(
            settings,
            validFeature,
            normalizedModel || null,
          );
      }
    }

    const nextSettings = await updateTeamAiSettingsAtomically(
      normalizedTeamId,
      buildNextSettings,
    );
    if (!nextSettings) {
      return res.status(404).json({ message: "Team not found" });
    }

    return res
      .status(200)
      .json(featureModelsResponse(nextSettings, customEndpointConfigured));
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ message: "Method not allowed" });
};

export default handler;
