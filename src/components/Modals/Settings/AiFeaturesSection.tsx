"use client";

import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import toast from "react-hot-toast";
import { useTeamAiProviders } from "@/hooks/useTeamAiProviders";
import { useTeamCustomEndpoint } from "@/hooks/useTeamCustomEndpoint";
import {
  aiImageModelDefinitions,
  aiModelDefinitions,
  aiModelOptions,
  getAiModelDefinition,
} from "@/lib/aiModelOptions";
import {
  AI_FEATURES,
  getSystemModelsForFeature,
  resolveImageModel,
  resolveSystemModel,
  resolveUserFacingModelOption,
  type AiFeature,
  type SystemFeature,
  type UserFacingModelFeature,
} from "@/lib/systemModelLadder";
import type { TAiProviderKey } from "@/lib/aiProviders";
import {
  DEFAULT_DICTATION_PROVIDER,
  DICTATION_PROVIDER_OPTIONS,
  type DictationProvider,
} from "@/lib/dictationProvider";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { cn } from "@/utils/undoActions/helperFuncs";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";
import { useSettingsTeam } from "./useSettingsTeam";

type FeatureModelRow = {
  enabled: boolean;
  model: string | null;
  effectiveModel: string | null;
  // Only present on the "dictation" row (transcription backend, no LLM model).
  provider?: DictationProvider;
};

type FeatureModelsResponse = Record<AiFeature, FeatureModelRow>;

type FeatureRowDefinition = {
  description: string;
  feature: AiFeature;
};

type FeatureSection = {
  title: string;
  rows: FeatureRowDefinition[];
};

type ModelChoice = {
  label: string;
  priceTier?: 1 | 2 | 3;
  provider: TAiProviderKey | "custom";
  value: string;
};

const FEATURE_SECTIONS: FeatureSection[] = [
  {
    title: "Assistants & editors",
    rows: [
      { feature: "aiChat", description: "Conversations with the AI assistant" },
      { feature: "taskWriter", description: "Drafts complete tasks from a prompt" },
      { feature: "writeWithAi", description: "Writes task descriptions and comments" },
      { feature: "improveWriting", description: "Editor improvements and AI slash commands" },
      { feature: "askAi", description: "Answers questions from search" },
      { feature: "boardGeneration", description: "Creates a starter board during onboarding" },
      { feature: "imageGeneration", description: "Generates images from task mentions" },
      { feature: "hyperAi", description: "Replies when people mention @HyperAI" },
    ],
  },
  {
    title: "Automatic",
    rows: [
      { feature: "summaries", description: "Summary shown at the top of a task" },
      { feature: "questionSuggestions", description: "Suggested questions in AI chat on a task" },
    ],
  },
  {
    title: "Voice",
    rows: [
      { feature: "dictation", description: "Turns recorded speech into text" },
    ],
  },
];

const featureModelsQueryKey = (teamId: string | null) => [
  "teamAiFeatureModels",
  teamId,
];

const modelDefinition = (model: string) =>
  aiModelDefinitions.find((definition) =>
    model.endsWith(`/${definition.key}`),
  );

const modelLabel = (model: string) =>
  aiModelOptions.find((option) => option.id === model)?.title ??
  aiImageModelDefinitions.find((definition) => definition.key === model)
    ?.label ??
  modelDefinition(model)?.label ??
  model.split("/").pop() ??
  model;

function FeatureModelDropdown({
  autoModel,
  choices,
  disabled,
  onChange,
  value,
}: {
  autoModel: string;
  choices: ModelChoice[];
  disabled: boolean;
  onChange: (model: string | null) => void;
  value: string | null;
}) {
  const [open, setOpen] = useState(false);
  const autoLabel = `Auto (${modelLabel(autoModel)}, recommended)`;
  const selectedLabel = value ? modelLabel(value) : autoLabel;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="relative w-full">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        className="flex w-full items-center justify-between gap-2 rounded-[4px] bg-active-modal-element px-2 py-1.5 text-left text-dense font-medium text-white-black shadow-[0_6px_20px_rgba(0,0,0,0.22)] transition hover:bg-hoverCardBackground focus-visible:bg-hoverCardBackground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          strokeWidth={1.75}
          className={cn(
            "h-4 w-4 shrink-0 text-text-light-gray transition",
            open && "rotate-180",
          )}
        />
      </button>

      {open && !disabled ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            className="absolute right-0 top-[calc(100%+6px)] z-20 max-h-[320px] w-full min-w-[280px] overflow-y-auto rounded-[4px] bg-modalBackground p-1.5 text-dense text-white-black shadow-[0_8px_30px_rgba(0,0,0,0.45)]"
          >
            <FeatureModelOption
              label={autoLabel}
              selected={value === null}
              onClick={() => {
                setOpen(false);
                onChange(null);
              }}
            />
            {choices.map((choice) => (
              <FeatureModelOption
                key={choice.value}
                label={choice.label}
                priceTier={choice.priceTier}
                selected={value === choice.value}
                onClick={() => {
                  setOpen(false);
                  onChange(choice.value);
                }}
              />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function FeatureModelOption({
  label,
  onClick,
  priceTier,
  selected,
}: {
  label: string;
  onClick: () => void;
  priceTier?: 1 | 2 | 3;
  selected: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-[4px] px-2.5 py-2 text-left transition-colors hover:bg-hoverCardBackground focus-visible:bg-hoverCardBackground focus-visible:outline-none",
          selected && "bg-active-modal-element",
        )}
        onClick={onClick}
      >
        <span>{label}</span>
        <span className="flex shrink-0 items-center gap-2">
          {priceTier ? (
            <span className="font-mono text-micro text-text-light-gray">
              {"$".repeat(priceTier)}
            </span>
          ) : null}
          <Check
            size={14}
            strokeWidth={1.75}
            className={cn(
              "text-hypertasks-purple",
              selected ? "opacity-100" : "opacity-0",
            )}
          />
        </span>
      </button>
    </li>
  );
}

function DictationProviderDropdown({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (provider: DictationProvider) => void;
  value: DictationProvider;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel =
    DICTATION_PROVIDER_OPTIONS.find((option) => option.value === value)
      ?.label ?? value;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="relative w-full">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        className="flex w-full items-center justify-between gap-2 rounded-[4px] bg-active-modal-element px-2 py-1.5 text-left text-dense font-medium text-white-black shadow-[0_6px_20px_rgba(0,0,0,0.22)] transition hover:bg-hoverCardBackground focus-visible:bg-hoverCardBackground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          strokeWidth={1.75}
          className={cn(
            "h-4 w-4 shrink-0 text-text-light-gray transition",
            open && "rotate-180",
          )}
        />
      </button>

      {open && !disabled ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            className="absolute right-0 top-[calc(100%+6px)] z-20 max-h-[320px] w-full min-w-[280px] overflow-y-auto rounded-[4px] bg-modalBackground p-1.5 text-dense text-white-black shadow-[0_8px_30px_rgba(0,0,0,0.45)]"
          >
            {DICTATION_PROVIDER_OPTIONS.map((option) => (
              <FeatureModelOption
                key={option.value}
                label={option.label}
                selected={value === option.value}
                onClick={() => {
                  setOpen(false);
                  onChange(option.value);
                }}
              />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

const AiFeaturesSection = () => {
  const queryClient = useQueryClient();
  const currentUser = useRecoilValue(currentUserAtom);
  const { ownerAndMembers, team, teamId } = useSettingsTeam();
  const { isLoading: providersLoading, providers } =
    useTeamAiProviders(teamId);
  const customEndpoint = useTeamCustomEndpoint(teamId);
  const [rows, setRows] = useState<FeatureModelsResponse | null>(null);
  const [savingFeature, setSavingFeature] = useState<AiFeature | "reset" | null>(
    null,
  );
  const queryKey = featureModelsQueryKey(teamId);
  const featureModelsQuery = useQuery<FeatureModelsResponse>({
    queryKey,
    enabled: Boolean(teamId),
    queryFn: async () => {
      const { data } = await axios.get<FeatureModelsResponse>(
        "/api/teams/aiFeatureModels",
        { params: { teamId } },
      );
      return data;
    },
  });

  useEffect(() => setRows(featureModelsQuery.data ?? null), [
    featureModelsQuery.data,
    teamId,
  ]);

  const canManage = Boolean(
    team &&
      currentUser &&
      ((currentUser.accountId &&
        team.googleAccountId === currentUser.accountId) ||
        ownerAndMembers.owner?.id === currentUser.id),
  );
  const providerSettings = useMemo(
    () => ({
      providers: Object.fromEntries(
        providers.map((provider) => [provider.key, provider.enabled]),
      ),
    }),
    [providers],
  );
  const enabledProviders = useMemo(
    () =>
      new Set(
        providers
          .filter((provider) => provider.enabled)
          .map((provider) => provider.key),
      ),
    [providers],
  );

  const choicesForFeature = (feature: AiFeature): ModelChoice[] => {
    const kind = AI_FEATURES[feature].modelKind;
    if (kind === "none") return [];
    if (kind === "fast") {
      return getSystemModelsForFeature(feature as SystemFeature)
        .filter((model) => enabledProviders.has(model.provider))
        .map((model) => ({
          value: model.model,
          label: modelLabel(model.model),
          provider: model.provider,
          priceTier: modelDefinition(model.model)?.priceTier,
        }));
    }
    if (kind === "image") {
      return aiImageModelDefinitions
        .filter((definition) => enabledProviders.has(definition.provider))
        .map((definition) => ({
          value: definition.key,
          label: definition.label,
          provider: definition.provider,
          priceTier: 3,
        }));
    }
    return aiModelOptions.flatMap((option) => {
      const definition = getAiModelDefinition(option.modelKey);
      if (
        !definition ||
        (definition.provider === "custom"
          ? !customEndpoint.configured
          : !enabledProviders.has(definition.provider))
      ) {
        return [];
      }
      return [
        {
          value: option.id,
          label:
            option.source === "custom"
              ? (customEndpoint.modelId ?? option.title)
              : option.title,
          provider: definition.provider,
          priceTier: definition.priceTier,
        },
      ];
    });
  };

  const autoModelForFeature = (feature: AiFeature) => {
    const kind = AI_FEATURES[feature].modelKind;
    if (kind === "fast") {
      return (
        resolveSystemModel(feature as SystemFeature, providerSettings)?.model ??
        getSystemModelsForFeature(feature as SystemFeature)[0].model
      );
    }
    if (kind === "image") {
      return (
        resolveImageModel(providerSettings)?.key ??
        aiImageModelDefinitions[0].key
      );
    }
    return (
      resolveUserFacingModelOption(
        feature as UserFacingModelFeature,
        providerSettings,
        undefined,
        { customEndpointConfigured: customEndpoint.configured },
      )?.id ?? aiModelOptions[0].id
    );
  };

  const save = async (
    feature: AiFeature,
    body:
      | { enabled: boolean }
      | { model: string | null }
      | { provider: DictationProvider },
    optimisticRow: FeatureModelRow,
  ) => {
    if (!teamId || !canManage || !rows) return;
    const previousRows = rows;
    const nextRows = { ...rows, [feature]: optimisticRow };
    setRows(nextRows);
    queryClient.setQueryData(queryKey, nextRows);
    setSavingFeature(feature);

    try {
      const { data } = await axios.post<FeatureModelsResponse>(
        "/api/teams/aiFeatureModels",
        { teamId, feature, ...body },
      );
      setRows(data);
      queryClient.setQueryData(queryKey, data);
    } catch (error) {
      setRows(previousRows);
      queryClient.setQueryData(queryKey, previousRows);
      const message = axios.isAxiosError(error)
        ? error.response?.data?.message
        : null;
      toast.error(message || "Could not update AI feature");
    } finally {
      setSavingFeature(null);
    }
  };

  const updateFeatureModel = (feature: AiFeature, model: string | null) => {
    if (!rows || rows[feature].model === model) return;
    void save(
      feature,
      { model },
      {
        ...rows[feature],
        model,
        effectiveModel: model ?? autoModelForFeature(feature),
      },
    );
  };

  const updateFeatureToggle = (feature: AiFeature) => {
    if (!rows) return;
    const enabled = !rows[feature].enabled;
    void save(feature, { enabled }, { ...rows[feature], enabled });
  };

  const updateDictationProvider = (provider: DictationProvider) => {
    if (!rows || rows.dictation.provider === provider) return;
    void save("dictation", { provider }, { ...rows.dictation, provider });
  };

  const resetToDefaults = async () => {
    if (!teamId || !canManage || savingFeature) return;
    if (
      !window.confirm(
        "Reset every AI feature model and toggle to the product defaults?",
      )
    ) {
      return;
    }

    setSavingFeature("reset");
    try {
      const { data } = await axios.post<FeatureModelsResponse>(
        "/api/teams/aiFeatureModels",
        { teamId, reset: true },
      );
      setRows(data);
      queryClient.setQueryData(queryKey, data);
      toast.success("AI features reset to defaults");
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? error.response?.data?.message
        : null;
      toast.error(message || "Could not reset AI features");
    } finally {
      setSavingFeature(null);
    }
  };

  const isLoading =
    providersLoading ||
    customEndpoint.isLoading ||
    (Boolean(teamId) && featureModelsQuery.isLoading);

  return (
    <SettingsSectionShell title="AI features">
      {!teamId ? (
        <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
          Open a team board before managing AI features.
        </p>
      ) : isLoading ? (
        <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
          Loading AI features
        </p>
      ) : featureModelsQuery.isError || !rows ? (
        <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
          Could not load AI features.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {FEATURE_SECTIONS.map((section, sectionIndex) => (
            <SettingsCard key={section.title}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-meta font-semibold uppercase tracking-wide text-text-light-gray">
                  {section.title}
                </h3>
                {sectionIndex === 0 ? (
                  <button
                    type="button"
                    disabled={!canManage || savingFeature !== null}
                    className="rounded-[4px] px-2 py-1 text-dense font-medium text-text-light-gray transition hover:bg-hoverCardBackground hover:text-white-black focus-visible:bg-hoverCardBackground focus-visible:text-white-black focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void resetToDefaults()}
                  >
                    Reset to defaults
                  </button>
                ) : null}
              </div>
              <div className="flex flex-col">
                {section.rows.map(({ description, feature }) => {
                  const choices = choicesForFeature(feature);
                  const selectedModel = choices.some(
                    (choice) => choice.value === rows[feature].model,
                  )
                    ? rows[feature].model
                    : null;
                  const hasModel = AI_FEATURES[feature].modelKind !== "none";
                  const userInitiated =
                    AI_FEATURES[feature].modelKind === "catalog" ||
                    AI_FEATURES[feature].modelKind === "image";

                  return (
                    <div
                      key={feature}
                      className="flex flex-col gap-3 border-b border-border-light-gray-thin px-2 py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between"
                      title={
                        canManage
                          ? undefined
                          : "Only the team owner can change AI features"
                      }
                    >
                      <div className="min-w-0 sm:pt-1">
                        <p className="font-semibold text-white-black">
                          {AI_FEATURES[feature].label}
                        </p>
                        <p className="text-text-light-gray">{description}</p>
                        {userInitiated ? (
                          <p className="mt-1 max-w-[520px] text-micro text-text-light-gray">
                            People can pick their own model for this in Default
                            models; your choice here is the team default.
                          </p>
                        ) : null}
                      </div>
                      <div className="flex w-full shrink-0 items-center gap-3 sm:w-[390px]">
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="w-6 text-micro font-medium text-text-light-gray">
                            {rows[feature].enabled ? "On" : "Off"}
                          </span>
                          <SettingsToggle
                            checked={rows[feature].enabled}
                            disabled={!canManage || savingFeature !== null}
                            hideLabel
                            inputId={`ai-feature-${feature}`}
                            label={`${AI_FEATURES[feature].label} ${
                              rows[feature].enabled ? "on" : "off"
                            }`}
                            onChange={() => updateFeatureToggle(feature)}
                          />
                        </div>
                        {feature === "dictation" ? (
                          <div className="min-w-0 flex-1">
                            <DictationProviderDropdown
                              disabled={
                                !canManage ||
                                !rows[feature].enabled ||
                                savingFeature !== null
                              }
                              value={
                                rows.dictation.provider ??
                                DEFAULT_DICTATION_PROVIDER
                              }
                              onChange={updateDictationProvider}
                            />
                          </div>
                        ) : hasModel ? (
                          <div className="min-w-0 flex-1">
                            <FeatureModelDropdown
                              autoModel={autoModelForFeature(feature)}
                              choices={choices}
                              disabled={
                                !canManage ||
                                !rows[feature].enabled ||
                                savingFeature !== null
                              }
                              value={selectedModel}
                              onChange={(model) =>
                                updateFeatureModel(feature, model)
                              }
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </SettingsCard>
          ))}
        </div>
      )}
    </SettingsSectionShell>
  );
};

export default AiFeaturesSection;
