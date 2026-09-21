"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  aiModelDefinitions,
  aiModelOptions,
  type TAiModelKey,
} from "@/lib/aiModelOptions";
import {
  AI_GATEWAY_BYOK_PROVIDER,
  AI_PROVIDERS,
  type TAiProviderInfo,
  type TByokProviderKey,
} from "@/lib/aiProviders";
import { teamByokKeysQueryKey } from "@/hooks/useTeamCustomEndpoint";
import { useTeamAiProviders } from "@/hooks/useTeamAiProviders";
import { currentUserAtom } from "@/store";
import { useRecoilValue } from "@/lib/state";
import SettingsCard from "./SettingsCard";
import { settingsActionButtonClass } from "./SettingsBillingRow";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";
import { useSettingsTeam } from "./useSettingsTeam";

const SAVE_DEBOUNCE_MS = 600;

const inputClass =
  "h-9 w-full border-0 bg-transparent px-2 font-mono text-dense font-medium text-white-black outline-none placeholder:font-sans placeholder:text-text-light-gray focus:bg-active-modal-element disabled:cursor-not-allowed disabled:text-text-light-gray";

const modelChipClass =
  "rounded-[4px] bg-active-modal-element px-1.5 py-[1px] text-micro font-medium text-text-light-gray";

type ServerRow = {
  enabled: boolean;
  hasSecret: boolean;
  maskedKey: string | null;
  baseUrl?: string | null;
  gdprCompliant?: boolean;
  modelId?: string | null;
};

type ByokKeyRow = ServerRow & { provider: TByokProviderKey };

type TestResponse = {
  result: "works" | "invalid" | "no_credit" | "error";
  status: number | null;
  model: string;
  elapsedMs: number;
};

type TestState = TestResponse | { result: "idle" } | { result: "testing" };

type ProviderRow = {
  source: TByokProviderKey;
  label: string;
  placeholder: string;
  keyUrl: string;
  keyUrlLabel: string;
  badge?: string;
  chinaHosted?: boolean;
  gdprNote?: string;
  requestDestination?: string;
  modelLabels: string[];
};

type CustomInputs = {
  apiKey: string;
  baseUrl: string;
  gdprCompliant: boolean;
  modelId: string;
};

function modelLabel(modelKey: TAiModelKey) {
  const option = aiModelOptions.find(
    (candidate) => candidate.modelKey === modelKey,
  );
  return (
    option?.title.replace(/ (Instant|Thinking|Light|High)$/, "") ?? modelKey
  );
}

function providerModelLabels(provider: TAiProviderInfo) {
  const labels = aiModelDefinitions
    .filter((model) => model.provider === provider.key)
    .map((model) => modelLabel(model.key));
  return [...new Set(labels)];
}

const gatewayRow: ProviderRow = {
  source: AI_GATEWAY_BYOK_PROVIDER.byokKey,
  label: AI_GATEWAY_BYOK_PROVIDER.label,
  placeholder: AI_GATEWAY_BYOK_PROVIDER.keyPlaceholder,
  keyUrl: AI_GATEWAY_BYOK_PROVIDER.keyUrl,
  keyUrlLabel: AI_GATEWAY_BYOK_PROVIDER.keyUrlLabel,
  modelLabels: ["Entire AI catalog"],
};

const providerRows: ProviderRow[] = AI_PROVIDERS.map((provider) => ({
  source: provider.byokKey,
  label: provider.label,
  placeholder: provider.keyPlaceholder,
  keyUrl: provider.keyUrl,
  keyUrlLabel: provider.keyUrlLabel,
  badge: provider.badge,
  chinaHosted: provider.chinaHosted,
  gdprNote: provider.gdprNote,
  requestDestination: provider.requestDestination,
  modelLabels:
    provider.key === "openrouter"
      ? ["Legacy model routes"]
      : providerModelLabels(provider),
}));

function testResultCopy(state: TestState | undefined) {
  if (!state || state.result === "idle") {
    return { className: "text-text-light-gray", text: "not tested" };
  }
  if (state.result === "testing") {
    return { className: "text-text-light-gray", text: "testing…" };
  }
  if (state.result === "works") {
    return {
      className: "text-hypertasks-green",
      text: `✓ works · ${state.model} replied in ${(state.elapsedMs / 1000).toFixed(1)}s`,
    };
  }
  if (state.result === "invalid") {
    return {
      className: "text-red-400",
      text: `✗ invalid key (${state.status ?? 401})`,
    };
  }
  if (state.result === "no_credit") {
    return { className: "text-red-400", text: "✗ no credit" };
  }
  return {
    className: "text-red-400",
    text: `✗ test failed${state.status ? ` (${state.status})` : ""}`,
  };
}

const ApiKeysSectionContent = () => {
  const queryClient = useQueryClient();
  const currentUser = useRecoilValue(currentUserAtom);
  const { ownerAndMembers, team, teamId } = useSettingsTeam();
  const { gdprSafeMode } = useTeamAiProviders(teamId);
  const [clearingKey, setClearingKey] = useState<Record<string, boolean>>({});
  const [customInputs, setCustomInputs] = useState<CustomInputs>({
    apiKey: "",
    baseUrl: "",
    gdprCompliant: false,
    modelId: "",
  });
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [serverRows, setServerRows] = useState<Record<string, ServerRow>>({});
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );
  const canManage = Boolean(
    team &&
    currentUser &&
    ((currentUser.accountId &&
      team.googleAccountId === currentUser.accountId) ||
      ownerAndMembers.owner?.id === currentUser.id),
  );
  const showReadOnlyNotice = Boolean(
    teamId && team && currentUser && !canManage,
  );

  const invalidateTeamQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["projectsAll"] });
    queryClient.invalidateQueries({ queryKey: ["getAllTeamsMinimal"] });
    queryClient.invalidateQueries({ queryKey: teamByokKeysQueryKey(teamId) });
  }, [queryClient, teamId]);

  const fetchKeys = useCallback(async () => {
    if (!teamId) return;
    const { data } = await axios.get<{ keys: ByokKeyRow[] }>(
      "/api/teams/byokKeys",
      { params: { teamId } },
    );
    const rows = Object.fromEntries(
      data.keys.map((key) => [key.provider, key]),
    );
    setServerRows(rows);
    const custom = rows.custom;
    setCustomInputs((previous) => ({
      apiKey: previous.apiKey,
      baseUrl: custom?.baseUrl ?? "",
      gdprCompliant: custom?.gdprCompliant ?? false,
      modelId: custom?.modelId ?? "",
    }));
  }, [teamId]);

  useEffect(() => {
    setCustomInputs({
      apiKey: "",
      baseUrl: "",
      gdprCompliant: false,
      modelId: "",
    });
    setKeyInputs({});
    setTestStates({});
  }, [teamId]);

  useEffect(() => {
    const timersRef = debounceTimers;
    return () => {
      for (const timer of Object.values(timersRef.current)) {
        clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!teamId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchKeys()
      .catch((error) => {
        if (!cancelled) {
          console.error(error);
          toast.error("Could not load API keys");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchKeys, teamId]);

  const scheduleKeyPersist = useCallback(
    (source: TByokProviderKey, value: string) => {
      if (!canManage || !teamId) return;

      const previousTimer = debounceTimers.current[source];
      if (previousTimer) clearTimeout(previousTimer);

      setTestStates((previous) => ({
        ...previous,
        [source]: { result: "idle" },
      }));
      debounceTimers.current[source] = setTimeout(async () => {
        const trimmed = value.trim();
        if (!trimmed) return;

        try {
          await axios.post("/api/teams/byokKeys", {
            apiKey: trimmed,
            provider: source,
            teamId,
          });
          await fetchKeys();
          setKeyInputs((previous) => ({
            ...previous,
            [source]: previous[source] === value ? "" : previous[source],
          }));
          invalidateTeamQueries();
        } catch (error) {
          const message = axios.isAxiosError(error)
            ? error.response?.data?.message
            : null;
          toast.error(message || "Could not save API key");
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [canManage, fetchKeys, invalidateTeamQueries, teamId],
  );

  const scheduleCustomPersist = useCallback(
    (next: CustomInputs) => {
      if (!canManage || !teamId) return;

      const previousTimer = debounceTimers.current.custom;
      if (previousTimer) clearTimeout(previousTimer);
      setTestStates((previous) => ({
        ...previous,
        custom: { result: "idle" },
      }));
      debounceTimers.current.custom = setTimeout(async () => {
        const apiKey = next.apiKey.trim();
        const baseUrl = next.baseUrl.trim();
        const modelId = next.modelId.trim();
        if (
          !baseUrl ||
          !modelId ||
          (!apiKey && !serverRows.custom?.hasSecret)
        ) {
          return;
        }

        try {
          await axios.post("/api/teams/byokKeys", {
            ...(apiKey ? { apiKey } : {}),
            baseUrl,
            gdprCompliant: next.gdprCompliant,
            modelId,
            provider: "custom",
            teamId,
          });
          await fetchKeys();
          setCustomInputs((previous) => ({
            ...previous,
            apiKey: previous.apiKey === next.apiKey ? "" : previous.apiKey,
          }));
          invalidateTeamQueries();
        } catch (error) {
          const message = axios.isAxiosError(error)
            ? error.response?.data?.message
            : null;
          toast.error(message || "Could not save custom endpoint");
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [
      canManage,
      fetchKeys,
      invalidateTeamQueries,
      serverRows.custom?.hasSecret,
      teamId,
    ],
  );

  const persistEnabled = async (source: TByokProviderKey, enabled: boolean) => {
    if (!canManage) return;

    try {
      await axios.post("/api/teams/byokKeys", {
        enabled,
        provider: source,
        teamId,
      });
      await fetchKeys();
      invalidateTeamQueries();
    } catch (error) {
      console.error(error);
      const message = axios.isAxiosError(error)
        ? error.response?.data?.message
        : null;
      toast.error(message || "Could not update API key");
    }
  };

  const clearKey = async (source: TByokProviderKey) => {
    if (!canManage) return;

    const timer = debounceTimers.current[source];
    if (timer) clearTimeout(timer);
    setClearingKey((previous) => ({ ...previous, [source]: true }));
    try {
      await axios.post("/api/teams/byokKeys", {
        clearSecret: true,
        provider: source,
        teamId,
      });
      await fetchKeys();
      setKeyInputs((previous) => ({ ...previous, [source]: "" }));
      if (source === "custom") {
        setCustomInputs({
          apiKey: "",
          baseUrl: "",
          gdprCompliant: false,
          modelId: "",
        });
      }
      setTestStates((previous) => ({
        ...previous,
        [source]: { result: "idle" },
      }));
      invalidateTeamQueries();
      toast.success("API key removed");
    } catch (error) {
      console.error(error);
      const message = axios.isAxiosError(error)
        ? error.response?.data?.message
        : null;
      toast.error(message || "Could not remove API key");
    } finally {
      setClearingKey((previous) => ({ ...previous, [source]: false }));
    }
  };

  const testKey = async (source: TByokProviderKey) => {
    if (!canManage) return;

    setTestStates((previous) => ({
      ...previous,
      [source]: { result: "testing" },
    }));
    try {
      const input = keyInputs[source]?.trim();
      const customPayload =
        source === "custom"
          ? {
              ...(customInputs.apiKey.trim()
                ? { apiKey: customInputs.apiKey.trim() }
                : {}),
              baseUrl: customInputs.baseUrl.trim(),
              gdprCompliant: customInputs.gdprCompliant,
              modelId: customInputs.modelId.trim(),
            }
          : {};
      const { data } = await axios.post<TestResponse>(
        "/api/settings/byok-test",
        {
          teamId,
          provider: source,
          ...(input ? { apiKey: input } : {}),
          ...customPayload,
        },
      );
      setTestStates((previous) => ({ ...previous, [source]: data }));
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? (error.response?.status ?? null)
        : null;
      setTestStates((previous) => ({
        ...previous,
        [source]: {
          result: "error",
          status,
          model: "",
          elapsedMs: 0,
        },
      }));
      const message = axios.isAxiosError(error)
        ? error.response?.data?.message
        : null;
      toast.error(message || "Could not test API key");
    }
  };

  const renderRow = (row: ProviderRow) => {
    const saved = serverRows[row.source];
    const enabled = saved?.enabled ?? false;
    const hasSecret = saved?.hasSecret ?? false;
    const inputValue = keyInputs[row.source] ?? "";
    const testState = testStates[row.source];
    const resultCopy = testResultCopy(testState);

    return (
      <div
        className="flex max-w-[760px] flex-col gap-3 border-b border-border-light-gray-thin px-2 py-3 last:border-b-0"
        key={row.source}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-dense font-semibold text-white-black">
            {row.label}
          </span>
          {row.chinaHosted ? (
            <span className={modelChipClass}>China-hosted</span>
          ) : row.badge ? (
            <span className={modelChipClass}>{row.badge}</span>
          ) : null}
          <span className="flex-1" />
          {saved?.maskedKey ? (
            <span className="font-mono text-micro text-text-light-gray">
              {saved.maskedKey}
            </span>
          ) : null}
          {hasSecret ? (
            <button
              aria-label={`Remove ${row.label} API key`}
              className={settingsActionButtonClass}
              disabled={!canManage || clearingKey[row.source]}
              onClick={() => clearKey(row.source)}
              type="button"
            >
              {clearingKey[row.source] ? "Removing" : "Remove"}
            </button>
          ) : null}
          <SettingsToggle
            checked={enabled}
            disabled={!canManage}
            hideLabel
            inputId={`settings-byok-toggle-${row.source}`}
            label={`Use ${row.label} API key`}
            onChange={() => persistEnabled(row.source, !enabled)}
          />
        </div>

        {row.modelLabels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.modelLabels.map((label) => (
              <span className={modelChipClass} key={label}>
                {label}
              </span>
            ))}
          </div>
        ) : null}

        {row.requestDestination ? (
          <p className="text-micro text-text-light-gray">
            With your key, requests go directly to {row.requestDestination}.
          </p>
        ) : null}

        {row.gdprNote ? (
          <p className="text-micro font-medium leading-snug text-text-light-gray">
            {row.gdprNote}
          </p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-2.5">
          <div className="min-w-[220px] flex-1 border-b border-light-black-border-1">
            <input
              autoComplete="off"
              className={inputClass}
              data-1p-ignore
              data-form-type="other"
              data-lpignore="true"
              disabled={!canManage}
              id={`settings-byok-key-${row.source}`}
              onChange={(event) => {
                const value = event.target.value;
                setKeyInputs((previous) => ({
                  ...previous,
                  [row.source]: value,
                }));
                scheduleKeyPersist(row.source, value);
              }}
              placeholder={hasSecret ? "Replace key…" : row.placeholder}
              spellCheck={false}
              style={{ WebkitTextSecurity: "disc" } as CSSProperties}
              type="text"
              value={inputValue}
            />
          </div>
          <button
            className={settingsActionButtonClass}
            disabled={
              !canManage ||
              testState?.result === "testing" ||
              (!hasSecret && !inputValue.trim())
            }
            onClick={() => testKey(row.source)}
            type="button"
          >
            Test key
          </button>
          <span
            className={`min-w-[150px] text-micro font-medium ${resultCopy.className}`}
            role="status"
          >
            {resultCopy.text}
          </span>
        </div>

        <p className="text-micro text-text-light-gray">
          Get a key at{" "}
          <a
            className="font-semibold text-white-black underline-offset-2 hover:underline"
            href={row.keyUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {row.keyUrlLabel}
          </a>
        </p>
      </div>
    );
  };

  const renderCustomRow = () => {
    const saved = serverRows.custom;
    const hasSecret = saved?.hasSecret ?? false;
    const testState = testStates.custom;
    const resultCopy = testResultCopy(testState);
    const updateCustomInput = (
      field: "apiKey" | "baseUrl" | "modelId",
      value: string,
    ) => {
      const next = { ...customInputs, [field]: value };
      setCustomInputs(next);
      scheduleCustomPersist(next);
    };
    const updateCustomCompliance = (gdprCompliant: boolean) => {
      const next = { ...customInputs, gdprCompliant };
      setCustomInputs(next);
      scheduleCustomPersist(next);
    };
    const canTest = Boolean(
      customInputs.baseUrl.trim() &&
      customInputs.modelId.trim() &&
      (hasSecret || customInputs.apiKey.trim()) &&
      (!gdprSafeMode || customInputs.gdprCompliant),
    );

    return (
      <div className="flex max-w-[760px] flex-col gap-3 border-b border-border-light-gray-thin px-2 py-3 last:border-b-0">
        <div className="flex items-center gap-2.5">
          <span className="text-dense font-semibold text-white-black">
            Custom endpoint
          </span>
          <span className="flex-1" />
          {saved?.maskedKey ? (
            <span className="font-mono text-micro text-text-light-gray">
              {saved.maskedKey}
            </span>
          ) : null}
          {hasSecret ? (
            <button
              aria-label="Remove custom endpoint"
              className={settingsActionButtonClass}
              disabled={!canManage || clearingKey.custom}
              onClick={() => clearKey("custom")}
              type="button"
            >
              {clearingKey.custom ? "Removing" : "Remove"}
            </button>
          ) : null}
        </div>

        <p className="text-micro leading-relaxed text-text-light-gray">
          Any OpenAI-compatible API, including Cloudflare AI Gateway, Groq,
          Together, or a self-hosted endpoint. Its model appears in the picker
          under Custom.
        </p>
        <p className="text-micro text-text-light-gray">
          With your key, requests go directly to your custom endpoint.
        </p>

        <div className="flex items-center gap-2.5">
          <SettingsToggle
            checked={customInputs.gdprCompliant}
            disabled={!canManage}
            hideLabel
            inputId="settings-custom-endpoint-gdpr-compliant"
            label="Custom endpoint operates under an EU/US data agreement"
            onChange={() =>
              updateCustomCompliance(!customInputs.gdprCompliant)
            }
          />
          <p className="text-micro text-text-light-gray">
            I confirm this endpoint operates under an EU/US data agreement.
            Required while GDPR safe mode is on.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="min-w-0 border-b border-light-black-border-1">
            <input
              aria-label="Custom endpoint base URL"
              autoComplete="off"
              className={inputClass}
              disabled={!canManage}
              onChange={(event) =>
                updateCustomInput("baseUrl", event.target.value)
              }
              placeholder="https://api.example.com/v1"
              spellCheck={false}
              type="url"
              value={customInputs.baseUrl}
            />
          </div>
          <div className="min-w-0 border-b border-light-black-border-1">
            <input
              aria-label="Custom endpoint API key"
              autoComplete="off"
              className={inputClass}
              data-1p-ignore
              data-form-type="other"
              data-lpignore="true"
              disabled={!canManage}
              onChange={(event) =>
                updateCustomInput("apiKey", event.target.value)
              }
              placeholder={hasSecret ? "Replace key…" : "API key"}
              spellCheck={false}
              style={{ WebkitTextSecurity: "disc" } as CSSProperties}
              type="text"
              value={customInputs.apiKey}
            />
          </div>
          <div className="min-w-0 border-b border-light-black-border-1">
            <input
              aria-label="Custom endpoint model ID"
              autoComplete="off"
              className={inputClass}
              disabled={!canManage}
              onChange={(event) =>
                updateCustomInput("modelId", event.target.value)
              }
              placeholder="Model id, e.g. llama-4-70b"
              spellCheck={false}
              type="text"
              value={customInputs.modelId}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            className={settingsActionButtonClass}
            disabled={!canManage || testState?.result === "testing" || !canTest}
            onClick={() => testKey("custom")}
            type="button"
          >
            Test endpoint
          </button>
          <span
            className={`min-w-[150px] text-micro font-medium ${resultCopy.className}`}
            role="status"
          >
            {resultCopy.text}
          </span>
        </div>
      </div>
    );
  };

  return (
    <SettingsSectionShell title="Bring your own key">
      <div className="-mt-4 flex max-w-[760px] flex-col gap-4">
        <p className="px-2 text-dense font-medium leading-relaxed text-text-light-gray">
          Add a provider key and requests to that provider&apos;s models run on
          your key instead of Hypertask&apos;s. Your key is stored encrypted,
          only used for your team, and never counts against your Hypertask AI
          budget.
        </p>
        <p className="px-2 text-dense font-medium leading-relaxed text-text-light-gray">
          <strong className="text-white-black">How it works:</strong> a key
          covers all models of that provider, everywhere in Hypertask. No key
          means models run on Hypertask&apos;s pooled allowance. Toggle a key
          off to fall back without deleting it.
        </p>
        {showReadOnlyNotice ? (
          <p className="text-micro font-medium text-text-light-gray">
            Only the team owner can change this.
          </p>
        ) : null}
      </div>

      {!teamId ? (
        <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
          Open a team board before managing API keys.
        </p>
      ) : loading ? (
        <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
          Loading API keys
        </p>
      ) : (
        <>
          <SettingsCard title="Gateway">{renderRow(gatewayRow)}</SettingsCard>
          <SettingsCard title="Providers">
            <div className="flex flex-col">
              {providerRows
                .filter((row) => !gdprSafeMode || !row.chinaHosted)
                .map(renderRow)}
            </div>
          </SettingsCard>
          <SettingsCard title="Advanced">{renderCustomRow()}</SettingsCard>
        </>
      )}
    </SettingsSectionShell>
  );
};

const ApiKeysSection = () => {
  const { billing } = useSettingsTeam();
  if (!billing || billing.storePlanId === "Free") return null;
  return <ApiKeysSectionContent />;
};

export default ApiKeysSection;
