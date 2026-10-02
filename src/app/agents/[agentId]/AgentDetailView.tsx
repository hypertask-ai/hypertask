"use client";

import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { cn } from "@/utils/undoActions/helperFuncs";
import Link from "next/link";
import { AgentBoardAccess } from "./AgentBoardAccess";
import { AgentConfigForm } from "./AgentConfigForm";
import { AgentDetailHeader } from "./AgentDetailHeader";
import { RecentActionsCard } from "./AgentDetailParts";
import { AgentInstructions } from "./AgentInstructions";
import { AgentRunHistory } from "./AgentRunHistory";
import type { useAgentBoardAccess } from "./useAgentBoardAccess";
import type { useAgentConfig } from "./useAgentConfig";
import type { useAgentDetailLifecycle } from "./useAgentDetailLifecycle";
import type { useAgentDetailState } from "./useAgentDetailState";
import type { useAgentProviderKey } from "./useAgentProviderKey";

type Props = Pick<
  ReturnType<typeof useAgentDetailState>,
  | "embedded"
  | "error"
  | "agent"
  | "editingName"
  | "nameDraft"
  | "setNameDraft"
  | "setEditingName"
  | "savingName"
  | "openingChat"
  | "togglePending"
  | "now"
  | "editingPrompt"
  | "setPromptDraft"
  | "setEditingPrompt"
  | "promptDraft"
  | "savingPrompt"
  | "tokenBusy"
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
  | "activity"
  | "activityError"
  | "boardAccessOpen"
  | "setBoardAccessOpen"
  | "pendingBoardId"
  | "setBoardToRemove"
  | "boardErrors"
  | "confirmTeamVisibility"
  | "setConfirmTeamVisibility"
  | "boardToRemove"
  | "manageOpen"
  | "setManageOpen"
  | "archiving"
  | "deleting"
  | "appShellRailOn"
> &
  Pick<
  ReturnType<typeof useAgentBoardAccess>,
  | "working"
  | "workingNowDot"
  | "workingNowLabel"
  | "activeWork"
  | "runtimeSnapshot"
  | "pendingQueue"
  | "visiblePending"
  | "operationsHealth"
  | "changeBoardMembership"
  | "handleArchiveToggle"
  | "handleDelete"
> &
  Pick<
  ReturnType<typeof useAgentConfig>,
  | "handleSaveName"
  | "handleSavePrompt"
  | "handleModelChange"
  | "handleVisibilityChange"
  | "handleImportantToggle"
  | "saveVisibility"
> &
  Pick<
  ReturnType<typeof useAgentDetailLifecycle>,
  | "handleOpenChat"
  | "handleToggle"
  | "handleGenerateToken"
  | "handleRevokeToken"
> &
  Pick<
  ReturnType<typeof useAgentProviderKey>,
  | "handleSaveProviderKey"
  | "handleRemoveProviderKey"
>;

export function AgentDetailView({
  embedded, error, agent, working, editingName, nameDraft, setNameDraft, handleSaveName,
  setEditingName, savingName, openingChat, handleOpenChat, handleToggle, togglePending,
  workingNowDot, workingNowLabel, activeWork, now, runtimeSnapshot, pendingQueue, visiblePending,
  editingPrompt, setPromptDraft, setEditingPrompt, promptDraft, savingPrompt, handleSavePrompt,
  tokenBusy, handleGenerateToken, handleRevokeToken, operationsHealth, handleModelChange,
  savingModel, editingProviderKey, providerKeyDraft, setProviderKeyDraft, handleSaveProviderKey,
  setEditingProviderKey, savingProviderKey, savingVisibility, providerKey, handleRemoveProviderKey,
  handleVisibilityChange, providerKeyLoaded, visibilityNotice, savingImportant,
  handleImportantToggle, currentUser, activity, activityError, boardAccessOpen, setBoardAccessOpen,
  pendingBoardId, setBoardToRemove, changeBoardMembership, boardErrors, confirmTeamVisibility,
  setConfirmTeamVisibility, saveVisibility, boardToRemove, manageOpen, setManageOpen, archiving,
  handleArchiveToggle, deleting, handleDelete, appShellRailOn,
}: Props) {
  const content = (
    <div
      className={cn(
        "bg-pageBackground text-white-black text-[14px]",
        !embedded && "min-h-screen",
      )}
    >
      <div className="max-w-[1120px] mx-auto px-6 py-7">
        <Link
          href="/agents"
          className="text-[13px] text-text-light-gray hover:text-white-black"
        >
          ← Agents
        </Link>

        {error && <p className="mt-6 text-[13px] text-red-500">{error}</p>}
        {!error && !agent && (
          <p className="mt-6 text-[13px] text-text-light-gray">
            Loading agent…
          </p>
        )}

        {!error && agent && (
          <>
            <AgentDetailHeader
              embedded={embedded}
              agent={agent}
              working={working}
              editingName={editingName}
              nameDraft={nameDraft}
              setNameDraft={setNameDraft}
              handleSaveName={handleSaveName}
              setEditingName={setEditingName}
              savingName={savingName}
              openingChat={openingChat}
              handleOpenChat={handleOpenChat}
              handleToggle={handleToggle}
              togglePending={togglePending}
            />

            <div
              className={cn(
                "mt-6 grid grid-cols-1 gap-5 items-start",
                !embedded && "lg:[grid-template-columns:1fr_300px]",
              )}
            >
              <div>
            <AgentRunHistory
              workingNowDot={workingNowDot}
              workingNowLabel={workingNowLabel}
              activeWork={activeWork}
              now={now}
              agent={agent}
              embedded={embedded}
              runtimeSnapshot={runtimeSnapshot}
              pendingQueue={pendingQueue}
              visiblePending={visiblePending}
            />

            <AgentInstructions
              agent={agent}
              editingPrompt={editingPrompt}
              setPromptDraft={setPromptDraft}
              setEditingPrompt={setEditingPrompt}
              promptDraft={promptDraft}
              savingPrompt={savingPrompt}
              handleSavePrompt={handleSavePrompt}
              tokenBusy={tokenBusy}
              handleGenerateToken={handleGenerateToken}
              handleRevokeToken={handleRevokeToken}
            />

              </div>

              <div className="flex flex-col gap-3">
            <AgentConfigForm
              operationsHealth={operationsHealth}
              agent={agent}
              runtimeSnapshot={runtimeSnapshot}
              now={now}
              handleModelChange={handleModelChange}
              savingModel={savingModel}
              editingProviderKey={editingProviderKey}
              providerKeyDraft={providerKeyDraft}
              setProviderKeyDraft={setProviderKeyDraft}
              handleSaveProviderKey={handleSaveProviderKey}
              setEditingProviderKey={setEditingProviderKey}
              savingProviderKey={savingProviderKey}
              savingVisibility={savingVisibility}
              providerKey={providerKey}
              handleRemoveProviderKey={handleRemoveProviderKey}
              handleVisibilityChange={handleVisibilityChange}
              providerKeyLoaded={providerKeyLoaded}
              visibilityNotice={visibilityNotice}
              savingImportant={savingImportant}
              handleImportantToggle={handleImportantToggle}
              currentUser={currentUser}
            />
              </div>
            </div>

            <RecentActionsCard
              activity={activity}
              error={activityError}
              showTokenUsage={agent.runtimeType === "NATIVE"}
              embedded={embedded}
            />

            <AgentBoardAccess
              boardAccessOpen={boardAccessOpen}
              setBoardAccessOpen={setBoardAccessOpen}
              agent={agent}
              pendingBoardId={pendingBoardId}
              setBoardToRemove={setBoardToRemove}
              changeBoardMembership={changeBoardMembership}
              boardErrors={boardErrors}
              confirmTeamVisibility={confirmTeamVisibility}
              setConfirmTeamVisibility={setConfirmTeamVisibility}
              saveVisibility={saveVisibility}
              boardToRemove={boardToRemove}
              manageOpen={manageOpen}
              setManageOpen={setManageOpen}
              archiving={archiving}
              handleArchiveToggle={handleArchiveToggle}
              deleting={deleting}
              handleDelete={handleDelete}
            />
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      {appShellRailOn && (
        <AppShellRail variant="global" currentUser={currentUser} />
      )}
      {appShellRailOn ? (
        <div className="pl-[var(--app-shell-rail-w,48px)]">{content}</div>
      ) : (
        content
      )}
    </>
  );
}
