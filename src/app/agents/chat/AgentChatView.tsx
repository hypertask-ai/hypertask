"use client";

import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { getAgentChatMobileBottomInset } from "@/lib/mobileCommentViewport";
import { cn } from "@/utils/undoActions/helperFuncs";
import { X } from "lucide-react";
import AgentDetail from "../[agentId]/AgentDetail";
import { AgentChatCreateModal } from "./AgentChatCreateModal";
import { AgentChatPane } from "./AgentChatPane";
import { AgentChatRosterPane } from "./AgentChatRosterPane";
import type { useAgentChatComposer } from "./useAgentChatComposer";
import type { useAgentChatDetailsSheet } from "./useAgentChatDetailsSheet";
import type { useAgentChatFeed } from "./useAgentChatFeed";
import type { useAgentChatNavigation } from "./useAgentChatNavigation";
import type { useAgentChatRoster } from "./useAgentChatRoster";
import type { useAgentChatSend } from "./useAgentChatSend";
import type { useAgentChatSession } from "./useAgentChatSession";
import type { useAgentChatState } from "./useAgentChatState";
import type { useAgentLifecycle } from "./useAgentLifecycle";

type Props = Pick<
  ReturnType<typeof useAgentChatState>,
  | "isNarrow"
  | "setShowCreateAgent"
  | "roomsEnabled"
  | "router"
  | "search"
  | "setSearch"
  | "teamId"
  | "rosterError"
  | "agents"
  | "selectedId"
  | "rosterNow"
  | "currentUser"
  | "pollingChatEnabled"
  | "deliveryMode"
  | "detailsCollapsed"
  | "setDetailsSheetOpen"
  | "openingFullChat"
  | "activityRowsEnabled"
  | "feedFilter"
  | "setFeedFilter"
  | "showScrollToBottom"
  | "isMbl"
  | "mobileLayoutEnabled"
  | "messageListRef"
  | "messagesError"
  | "sessionLoading"
  | "messages"
  | "sending"
  | "queuedMessages"
  | "awaiting"
  | "deliveryNotice"
  | "replyTimedOut"
  | "stopping"
  | "mentionOpen"
  | "mentionLoading"
  | "mentionLoadError"
  | "mentionResults"
  | "mentionQuery"
  | "setMentionIndex"
  | "mentionIndex"
  | "draft"
  | "composerRef"
  | "composerEditorRef"
  | "isDictationProcessing"
  | "setIsRecording"
  | "setIsDictationProcessing"
  | "mobileFullscreenFlag"
  | "isRecording"
  | "detailsSheetOpen"
  | "detailsDialogRef"
  | "creatingAgent"
  | "setCreateAgentError"
  | "setNewAgentName"
  | "setNewAgentToken"
  | "setTokenCopied"
  | "newAgentToken"
  | "showCreateAgent"
  | "tokenCopied"
  | "newAgentName"
  | "createAgentError"
  | "mobileAgentChatViewport"
  | "appShellRailOn"
> &
  Pick<
  ReturnType<typeof useAgentChatNavigation>,
  | "teams"
  | "roster"
  | "selectedAgent"
  | "mobileFullscreenChrome"
  | "isExternal"
  | "reuseAiComposer"
  | "dictationProjectId"
> &
  Pick<
  ReturnType<typeof useAgentChatRoster>,
  | "setTeamFilter"
  | "projectIdForPrefix"
> &
  Pick<
  ReturnType<typeof useAgentChatSession>,
  | "selectAgent"
  | "handleProposalAction"
> &
  Pick<
  ReturnType<typeof useAgentLifecycle>,
  | "backToRoster"
  | "toggleDetails"
  | "handleOpenFullChat"
  | "createAgent"
> &
  Pick<
  ReturnType<typeof useAgentChatFeed>,
  | "scrollMessagesToBottom"
  | "handleMessageListScroll"
  | "visibleFeed"
  | "activeFeedFilter"
  | "composerLocked"
> &
  Pick<
  ReturnType<typeof useAgentChatSend>,
  | "removeQueuedMessage"
  | "handleStop"
  | "handleSend"
> &
  Pick<
  ReturnType<typeof useAgentChatComposer>,
  | "pickMention"
  | "handleComposerChange"
  | "handleComposerKeyDown"
  | "insertDictation"
> &
  Pick<
  ReturnType<typeof useAgentChatDetailsSheet>,
  | "detailsSheetShown"
>;

export function AgentChatView({
  isNarrow, setShowCreateAgent, roomsEnabled, router, search, setSearch, teams, teamId,
  setTeamFilter, rosterError, agents, roster, selectedId, selectAgent, rosterNow, selectedAgent,
  currentUser, backToRoster, mobileFullscreenChrome, pollingChatEnabled, deliveryMode,
  toggleDetails, detailsCollapsed, setDetailsSheetOpen, isExternal, openingFullChat,
  handleOpenFullChat, activityRowsEnabled, feedFilter, setFeedFilter, showScrollToBottom, isMbl,
  mobileLayoutEnabled, scrollMessagesToBottom, messageListRef, handleMessageListScroll,
  messagesError, sessionLoading, messages, visibleFeed, activeFeedFilter, projectIdForPrefix,
  handleProposalAction, sending, queuedMessages, removeQueuedMessage,
  awaiting, deliveryNotice, replyTimedOut, handleStop, stopping, reuseAiComposer, mentionOpen,
  mentionLoading, mentionLoadError, mentionResults, mentionQuery, setMentionIndex, pickMention,
  mentionIndex, draft, composerRef, composerEditorRef, handleComposerChange, handleComposerKeyDown,
  composerLocked, isDictationProcessing, setIsRecording, setIsDictationProcessing, insertDictation,
  mobileFullscreenFlag, dictationProjectId, isRecording, handleSend, detailsSheetShown,
  detailsSheetOpen, detailsDialogRef, creatingAgent, setCreateAgentError, setNewAgentName,
  setNewAgentToken, setTokenCopied, newAgentToken, showCreateAgent, tokenCopied, newAgentName,
  createAgent, createAgentError, mobileAgentChatViewport,
  appShellRailOn,
}: Props) {
  const rosterPane = (
            <AgentChatRosterPane
              isNarrow={isNarrow}
              setShowCreateAgent={setShowCreateAgent}
              roomsEnabled={roomsEnabled}
              router={router}
              search={search}
              setSearch={setSearch}
              teams={teams}
              teamId={teamId}
              setTeamFilter={setTeamFilter}
              rosterError={rosterError}
              agents={agents}
              roster={roster}
              selectedId={selectedId}
              selectAgent={selectAgent}
              rosterNow={rosterNow}
            />
  );

  const detailsContent = selectedAgent ? (
    <AgentDetail
      agentId={selectedAgent.slug ?? selectedAgent.id}
      currentUser={currentUser}
      embedded
    />
  ) : null;

  const chatPane = (
            <AgentChatPane
              selectedAgent={selectedAgent}
              isNarrow={isNarrow}
              backToRoster={backToRoster}
              mobileFullscreenChrome={mobileFullscreenChrome}
              pollingChatEnabled={pollingChatEnabled}
              deliveryMode={deliveryMode}
              toggleDetails={toggleDetails}
              detailsCollapsed={detailsCollapsed}
              setDetailsSheetOpen={setDetailsSheetOpen}
              isExternal={isExternal}
              openingFullChat={openingFullChat}
              handleOpenFullChat={handleOpenFullChat}
              activityRowsEnabled={activityRowsEnabled}
              feedFilter={feedFilter}
              setFeedFilter={setFeedFilter}
              showScrollToBottom={showScrollToBottom}
              isMbl={isMbl}
              mobileLayoutEnabled={mobileLayoutEnabled}
              scrollMessagesToBottom={scrollMessagesToBottom}
              messageListRef={messageListRef}
              handleMessageListScroll={handleMessageListScroll}
              messagesError={messagesError}
              sessionLoading={sessionLoading}
              messages={messages}
              visibleFeed={visibleFeed}
              activeFeedFilter={activeFeedFilter}
              projectIdForPrefix={projectIdForPrefix}
              handleProposalAction={handleProposalAction}
              sending={sending}
              queuedMessages={queuedMessages}
              removeQueuedMessage={removeQueuedMessage}
              awaiting={awaiting}
              deliveryNotice={deliveryNotice}
              replyTimedOut={replyTimedOut}
              handleStop={handleStop}
              stopping={stopping}
              reuseAiComposer={reuseAiComposer}
              mentionOpen={mentionOpen}
              mentionLoading={mentionLoading}
              mentionLoadError={mentionLoadError}
              mentionResults={mentionResults}
              mentionQuery={mentionQuery}
              setMentionIndex={setMentionIndex}
              pickMention={pickMention}
              mentionIndex={mentionIndex}
              draft={draft}
              composerRef={composerRef}
              composerEditorRef={composerEditorRef}
              handleComposerChange={handleComposerChange}
              handleComposerKeyDown={handleComposerKeyDown}
              composerLocked={composerLocked}
              isDictationProcessing={isDictationProcessing}
              setIsRecording={setIsRecording}
              setIsDictationProcessing={setIsDictationProcessing}
              insertDictation={insertDictation}
              mobileFullscreenFlag={mobileFullscreenFlag}
              dictationProjectId={dictationProjectId}
              isRecording={isRecording}
              handleSend={handleSend}
            />
  );


  const closeDetailsSheet = () => detailsDialogRef.current?.close();
  const detailsSheet = detailsSheetShown ? (
    <dialog
      ref={detailsDialogRef}
      aria-label="Agent details"
      onClose={() => setDetailsSheetOpen(false)}
      onClick={(e) => {
        // Clicks inside the panel land on the panel; a click that reaches the
        // dialog itself is the strip beside it, i.e. the backdrop.
        if (e.target === detailsDialogRef.current) closeDetailsSheet();
      }}
      className="m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/60"
    >
      <div className="ml-auto flex h-full w-[85%] max-w-[380px] flex-col overflow-y-auto bg-pageBackground shadow-md">
        <div className="flex shrink-0 items-center justify-between px-4 py-3">
          <span className="text-dense font-medium text-text-light-gray">
            Agent details
          </span>
          <button
            type="button"
            onClick={closeDetailsSheet}
            aria-label="Close details"
            className="text-text-light-gray hover:text-white-black"
          >
            <X size={16} />
          </button>
        </div>
        {detailsContent}
      </div>
    </dialog>
  ) : null;

  const createAgentModal = (
            <AgentChatCreateModal
              creatingAgent={creatingAgent}
              setShowCreateAgent={setShowCreateAgent}
              setCreateAgentError={setCreateAgentError}
              setNewAgentName={setNewAgentName}
              setNewAgentToken={setNewAgentToken}
              setTokenCopied={setTokenCopied}
              newAgentToken={newAgentToken}
              showCreateAgent={showCreateAgent}
              tokenCopied={tokenCopied}
              newAgentName={newAgentName}
              createAgent={createAgent}
              createAgentError={createAgentError}
            />
  );

  let mobileAgentChatHeight: string | undefined;
  const mobileChromeAwareHeight = isMbl;
  if (mobileChromeAwareHeight) {
    // Full visible viewport with top/dock padding inside the same border-box
    // (AI chat pattern). Avoids h-screen oversizing and mid-screen composer gap.
    mobileAgentChatHeight = mobileAgentChatViewport
      ? `${mobileAgentChatViewport.visibleHeight}px`
      : "100dvh";
  }
  const hideDockInset = mobileFullscreenChrome;
  const mobileComposerBottomInset = isMbl
    ? getAgentChatMobileBottomInset({
        dockHeight: mobileAgentChatViewport?.dockHeight ?? 0,
        keyboardInset: mobileAgentChatViewport?.bottomInset ?? 0,
        hideDock: hideDockInset,
      })
    : 0;
  const keyboardOpen =
    isMbl && (mobileAgentChatViewport?.bottomInset ?? 0) > 0;

  let mobileShellPaddingStyle: { paddingBottom?: number } | undefined;
  if (isMbl && hideDockInset && keyboardOpen) {
    mobileShellPaddingStyle = { paddingBottom: 0 };
  } else if (isMbl && !hideDockInset) {
    mobileShellPaddingStyle = { paddingBottom: mobileComposerBottomInset };
  }

  if (isNarrow) {
    return (
      <div
        className={cn(
          "flex flex-col overflow-hidden bg-pageBackground text-white-black text-[14px]",
          !(isMbl && (mobileLayoutEnabled || mobileFullscreenChrome)) &&
            "h-screen",
          // Flag-off: reserve app top bar + dock. Flag-on with an agent open:
          // no shell chrome; keep safe-area only when the keyboard is closed.
          isMbl &&
            !hideDockInset &&
            "mobile-tab-bar-content pt-[var(--mobile-top-bar-h)] pb-[max(var(--mobile-dock-h,64px),64px)]",
          isMbl &&
            hideDockInset &&
            !keyboardOpen &&
            "pb-[env(safe-area-inset-bottom)]",
          isMbl &&
            (mobileLayoutEnabled || mobileFullscreenChrome) &&
            "mobile-agent-chat min-h-0 overscroll-y-none",
        )}
        style={{
          height: mobileAgentChatHeight,
          ...mobileShellPaddingStyle,
        }}
      >
        {selectedAgent ? chatPane : rosterPane}
        {detailsSheet}
        {createAgentModal}
      </div>
    );
  }

  const content = (
    <div className="flex h-screen overflow-hidden bg-pageBackground text-white-black text-[14px]">
      {rosterPane}
      {chatPane}
      {selectedAgent && !detailsCollapsed && (
        <aside className="min-h-0 w-[380px] shrink-0 overflow-y-auto border-l border-comment-description-border xl:w-[560px] 2xl:w-[760px]">
          {detailsContent}
        </aside>
      )}
      {createAgentModal}
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
