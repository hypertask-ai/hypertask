"use client";

import { useFlag } from "@/hooks/useFlag";
import { HTPR_7010_HAIKU_5_5_FLAG } from "@/lib/flags/keys";
import { aiModelOptions, isAiModelOptionVisible } from "@/lib/aiModelOptions";
import { canPinModelOption } from "@/lib/nativeAgent/modelPin";
import { cn } from "@/utils/undoActions/helperFuncs";
import AgentSelect, { AgentOption } from "../AgentSelect";
import { AgentSwitch, elapsedSince, healthDotClass, healthLabel, InfoRow, timeAgo } from "./AgentDetailParts";
import type { useAgentBoardAccess } from "./useAgentBoardAccess";
import type { useAgentConfig } from "./useAgentConfig";
import type { useAgentDetailState } from "./useAgentDetailState";
import type { useAgentProviderKey } from "./useAgentProviderKey";

type Props = Pick<
  ReturnType<typeof useAgentBoardAccess>,
  | "operationsHealth"
  | "runtimeSnapshot"
> &
  Pick<
  ReturnType<typeof useAgentDetailState>,
  | "now"
  | "savingModel"
  | "editingProviderKey"
  | "providerKeyDraft"
  | "setProviderKeyDraft"
  | "setEditingProviderKey"
  | "savingProviderKey"
  | "savingVisibility"
  | "providerKey"
  | "providerKeyLoaded"
  | "visibilityNotice"
  | "savingImportant"
  | "currentUser"
> &
  { agent: NonNullable<ReturnType<typeof useAgentDetailState>["agent"]> } &
  Pick<
  ReturnType<typeof useAgentConfig>,
  | "handleModelChange"
  | "handleVisibilityChange"
  | "handleImportantToggle"
> &
  Pick<
  ReturnType<typeof useAgentProviderKey>,
  | "handleSaveProviderKey"
  | "handleRemoveProviderKey"
>;

export function AgentConfigForm({
  operationsHealth, agent, runtimeSnapshot, now, handleModelChange, savingModel,
  editingProviderKey, providerKeyDraft, setProviderKeyDraft, handleSaveProviderKey,
  setEditingProviderKey, savingProviderKey, savingVisibility, providerKey, handleRemoveProviderKey,
  handleVisibilityChange, providerKeyLoaded, visibilityNotice, savingImportant,
  handleImportantToggle, currentUser,
}: Props) {
  const haiku55Enabled = useFlag(HTPR_7010_HAIKU_5_5_FLAG);
  return (
    <>
                <section className="bg-comment-description rounded-[4px] px-4 py-3 shadow-md flex flex-col gap-1.5">
                  <h2 className="font-semibold mb-1">Runtime health</h2>
                  <InfoRow label="State">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          healthDotClass[operationsHealth],
                        )}
                      />
                      {healthLabel[operationsHealth]}
                    </span>
                  </InfoRow>
                  <InfoRow label="Source">
                    {agent.operations.source === "runtime"
                      ? "Live worker"
                      : "Inferred from board"}
                  </InfoRow>
                  <InfoRow label="Worker">
                    {runtimeSnapshot?.workerId ?? "Not connected"}
                  </InfoRow>
                  <InfoRow label="Heartbeat">
                    {runtimeSnapshot?.heartbeatAt
                      ? `${elapsedSince(runtimeSnapshot.heartbeatAt, now)} ago`
                      : "Never"}
                  </InfoRow>
                  <InfoRow label="Progress">
                    {runtimeSnapshot?.lastProgressAt
                      ? `${elapsedSince(runtimeSnapshot.lastProgressAt, now)} ago`
                      : "Unreported"}
                  </InfoRow>
                </section>

                <section className="bg-comment-description rounded-[4px] px-4 py-3 shadow-md flex flex-col gap-1.5">
                  <h2 className="font-semibold mb-1">Configuration</h2>
                <InfoRow label="Runs on">
                  {agent.runtimeType === "NATIVE"
                    ? "Hypertask · native"
                    : "Your own runtime"}
                </InfoRow>
                {/* Only a native agent's turns run on Hypertask's models, so
                    an external agent gets no picker rather than one that
                    saves and changes nothing. */}
                {agent.runtimeType === "NATIVE" && (
                  <InfoRow label="Model">
                    <AgentSelect
                      value={agent.modelOptionId ?? ""}
                      onChange={handleModelChange}
                      disabled={savingModel}
                      ariaLabel="Model this agent runs on"
                    >
                      <AgentOption value="">Team default</AgentOption>
                      {/* Same list the PATCH route enforces, so the picker can
                        never offer something the API will reject. */}
                      {aiModelOptions
                        .filter((option) => canPinModelOption(option.id) && isAiModelOptionVisible(option, haiku55Enabled))
                        .map((option) => (
                          <AgentOption key={option.id} value={option.id}>
                            {option.title}
                          </AgentOption>
                        ))}
                    </AgentSelect>
                  </InfoRow>
                )}
                {/* Team key by default. Pasting a key here moves this agent's
                    spend onto that provider account, which is what makes its
                    cost an invoice instead of an estimate. */}
                <InfoRow label="Provider key">
                  {editingProviderKey ? (
                    <input
                      autoFocus
                      type="password"
                      value={providerKeyDraft}
                      onChange={(e) => setProviderKeyDraft(e.target.value)}
                      onBlur={() => void handleSaveProviderKey()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSaveProviderKey();
                        if (e.key === "Escape") {
                          setProviderKeyDraft("");
                          setEditingProviderKey(false);
                        }
                      }}
                      disabled={savingProviderKey || savingVisibility}
                      placeholder="Paste an OpenRouter key"
                      aria-label="OpenRouter key for this agent"
                      className="bg-transparent outline-none min-w-0 w-[220px]"
                    />
                  ) : (
                    <span
                      className="flex items-center gap-2"
                      data-agent-provider-key
                    >
                      <span
                        className="cursor-text"
                        title="Click to set an OpenRouter key"
                        onClick={() => setEditingProviderKey(true)}
                      >
                        {providerKey?.maskedKey
                          ? `OpenRouter ${providerKey.maskedKey}`
                          : "Team key"}
                      </span>
                      {providerKey?.maskedKey && (
                        <button
                          type="button"
                          disabled={savingProviderKey || savingVisibility}
                          className="text-[12px] text-text-light-gray"
                          onClick={() => void handleRemoveProviderKey()}
                        >
                          Remove
                        </button>
                      )}
                    </span>
                  )}
                </InfoRow>
                <InfoRow label="Visibility">
                  <span className="flex min-w-0 flex-col gap-1">
                    <AgentSelect
                      value={agent.visibility}
                      onChange={handleVisibilityChange}
                      disabled={
                        savingVisibility ||
                        savingProviderKey ||
                        (agent.runtimeType === "NATIVE" && !providerKeyLoaded)
                      }
                      ariaLabel="Who can use this agent"
                    >
                      <AgentOption value="PRIVATE">Private</AgentOption>
                      <AgentOption value="TEAM">Team</AgentOption>
                    </AgentSelect>
                    {visibilityNotice && (
                      <span
                        className={cn(
                          "text-[12px] leading-4",
                          visibilityNotice.kind === "error"
                            ? "text-red-500"
                            : "text-hypertasks-green",
                        )}
                      >
                        {visibilityNotice.text}
                      </span>
                    )}
                  </span>
                </InfoRow>
                <InfoRow label="Important">
                  <span className="flex items-center gap-2">
                    <AgentSwitch
                      on={agent.postsToImportant !== false}
                      displayName={agent.displayName}
                      pending={savingImportant}
                      ariaLabel={`Let ${agent.displayName} post to Important`}
                      onToggle={() => void handleImportantToggle()}
                    />
                    <span className="text-text-light-gray">
                      {agent.postsToImportant === false
                        ? "Agents split only"
                        : "Can post"}
                    </span>
                  </span>
                </InfoRow>
                <InfoRow label="Owner">
                  {currentUser.displayName || "You"}
                </InfoRow>
                <InfoRow label="Created">
                  {new Date(agent.createdAt).toLocaleDateString()}
                </InfoRow>
                {agent.runtimeType === "NATIVE" && (
                  <InfoRow label="Heartbeat">
                    {agent.heartbeatAt ? (
                      timeAgo(agent.heartbeatAt)
                    ) : (
                      <span className="text-text-light-gray">Never</span>
                    )}
                  </InfoRow>
                )}
                </section>
    </>
  );
}
