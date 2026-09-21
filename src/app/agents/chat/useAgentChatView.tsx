import { chatStatusText, emptyFeedText, ActivityGroup, FeedFilter, MessageBubble, RosterRow, ScrollToBottomButton } from "./AgentChatViewParts";
import { useEffect } from "react";
import AppShellRail from "@/components/PageComponents/Kanban/HeaderComponents/AppShellRail";
import { cn } from "@/utils/undoActions/helperFuncs";
import { ArrowLeft, ChevronLeft, ChevronRight, Info, Plus, X } from "lucide-react";
import { TypingIndicator } from "@/components/AI_CHAT/TypingIndicator";
import AgentSelect, { AgentOption } from "../AgentSelect";
import AgentDetail from "../[agentId]/AgentDetail";
import AgentAvatar from "@/components/Agents/AgentAvatar";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { getAgentChatMobileBottomInset } from "@/lib/mobileCommentViewport";
import { AudioButton } from "@/components/RTE/Components/AudioButton";
import { AI_Tiptap_Container } from "@/components/AI_CHAT/AI_Tiptap_Container";
import { QueuedMessagesStrip } from "@/components/Common/QueuedMessagesStrip";
import { ModalContainerCustom, ModalHeaderComp, ModalInput } from "@/components/Common/CommonModalComponents";

type ViewContext = Record<string, any>;

export function useAgentChatView(context: ViewContext) {
  const { activeFeedFilter, activityRowsEnabled, agents, appShellRailOn, awaiting, backToRoster, chatStopAndTimeoutEnabled, composerEditorRef, composerLocked, composerRef, createAgent, createAgentError, creatingAgent, currentUser, deliveryMode, deliveryNotice, detailsCollapsed, detailsDialogRef, detailsSheetOpen, dictationProjectId, draft, feedFilter, handleComposerChange, handleComposerKeyDown, handleMessageListScroll, handleOpenFullChat, handleProposalAction, handleSend, handleStop, insertDictation, isDictationProcessing, isExternal, isMbl, isNarrow, isRecording, mentionIndex, mentionLoadError, mentionLoading, mentionOpen, mentionQuery, mentionResults, messageListRef, messages, messagesError, mobileAgentChatViewport, mobileAgentChatViewportEnabled, mobileFullscreenChrome, mobileFullscreenFlag, mobileLayoutEnabled, newAgentName, newAgentToken, openingFullChat, pickMention, pollingChatEnabled, projectIdForPrefix, queuedMessages, removeQueuedMessage, replyTimedOut, reuseAiComposer, roomsEnabled, roster, rosterError, rosterNow, router, scrollMessagesToBottom, search, selectAgent, selectedAgent, selectedId, sending, sessionLoading, setCreateAgentError, setDetailsSheetOpen, setFeedFilter, setIsDictationProcessing, setIsRecording, setMentionIndex, setNewAgentName, setNewAgentToken, setSearch, setShowCreateAgent, setTeamFilter, setTokenCopied, showCreateAgent, showScrollToBottom, stopping, teamId, teams, toggleDetails, tokenCopied, visibleFeed } = context;
const rosterPane = (
    <aside
      className={cn(
        "flex flex-col min-h-0",
        isNarrow ? "flex-1" : "w-[300px] shrink-0 border-r border-comment-description-border",
      )}
    >
      <div className="px-3 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <h1 className="px-1 text-[16px] font-semibold">Agent Chat</h1>
          <button
            type="button"
            onClick={() => setShowCreateAgent(true)}
            aria-label="Add agent"
            className={cn(
              MOBILE_TARGET,
              "rounded-[4px] text-text-light-gray hover:text-white-black hover:bg-hoverCardBackground",
            )}
          >
            <Plus size={16} />
          </button>
        </div>
        {roomsEnabled && (
          <button
            type="button"
            onClick={() => router.push("/agents/chat?view=rooms")}
            className="mt-2 flex w-full items-center justify-between rounded-[4px] bg-cardBackground px-3 py-2 text-left text-dense hover:bg-hoverCardBackground"
          >
            <span>Board rooms</span>
            <span className="text-meta text-text-light-gray">All bots</span>
          </button>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents"
          aria-label="Search agents"
          className="mt-2 w-full rounded-[4px] bg-cardBackground px-3 py-1.5 text-dense outline-none placeholder:text-text-light-gray"
        />
        {teams.length > 0 && (
          <AgentSelect
            value={teamId ?? ""}
            ariaLabel="Filter agents by team"
            onChange={(next) => setTeamFilter(next || null)}
            className="mt-2 w-full"
          >
            <AgentOption value="">All teams</AgentOption>
            {teams.map((team: any) => (
              <AgentOption key={team.id} value={team.id}>
                {team.name}
              </AgentOption>
            ))}
          </AgentSelect>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {rosterError && (
          <p className="px-2 py-3 text-meta text-red-500">{rosterError}</p>
        )}
        {!rosterError && !agents && (
          <p className="px-2 py-3 text-meta text-text-light-gray">
            Loading agents…
          </p>
        )}
        {agents && roster.length === 0 && (
          <p className="px-2 py-3 text-meta text-text-light-gray">
            No agents match.
          </p>
        )}
        {roster.map((agent: any) => (
          <RosterRow
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedId}
            onSelect={selectAgent}
            now={rosterNow}
          />
        ))}
      </div>
    </aside>
  );

const detailsContent = selectedAgent ? (
    <AgentDetail
      agentId={selectedAgent.slug ?? selectedAgent.id}
      currentUser={currentUser}
      embedded
    />
  ) : null;

const chatPane = selectedAgent ? (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-comment-description-border px-4 py-3">
        {isNarrow && (
          <button
            type="button"
            onClick={backToRoster}
            aria-label="Back to agents"
            className="text-text-light-gray hover:text-white-black"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        {!mobileFullscreenChrome && (
          <AgentAvatar agentId={selectedAgent.id} name={selectedAgent.displayName} photoURL={selectedAgent.photoURL} size={28} className="text-[11px]" />
        )}
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold">
            {selectedAgent.displayName}
          </p>
          {!mobileFullscreenChrome && (
            <p className="truncate text-meta text-text-light-gray">
              {chatStatusText(selectedAgent)}
              {pollingChatEnabled && deliveryMode === "polling"
                ? " · polling"
                : ""}
            </p>
          )}
        </div>
        <span className="flex-1" />
        {!isNarrow && (
          <button
            type="button"
            onClick={toggleDetails}
            aria-label={detailsCollapsed ? "Show details" : "Hide details"}
            className="text-text-light-gray hover:text-white-black"
          >
            {detailsCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
        {isNarrow && !mobileFullscreenChrome && (
          <button
            type="button"
            onClick={() => setDetailsSheetOpen(true)}
            aria-label="Agent details"
            className="text-text-light-gray hover:text-white-black"
          >
            <Info size={16} />
          </button>
        )}
      </header>

      {!isExternal ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="max-w-[340px] text-dense text-text-light-gray">
            {selectedAgent.displayName} is a Hypertask native agent. Its chat
            lives in the full AI chat surface.
          </p>
          <button
            type="button"
            disabled={openingFullChat}
            onClick={() => void handleOpenFullChat()}
            className="text-dense text-hypertasks-purple disabled:opacity-50"
          >
            {openingFullChat ? "Opening…" : "Open full chat"}
          </button>
        </div>
      ) : (
        <>
          {activityRowsEnabled && (
            <div className="shrink-0 border-b border-comment-description-border px-4 py-2">
              <FeedFilter value={feedFilter} onChange={setFeedFilter} />
            </div>
          )}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {showScrollToBottom && !(isMbl && mobileLayoutEnabled) && (
              <ScrollToBottomButton
                onClick={() => scrollMessagesToBottom("smooth")}
              />
            )}
          <div
            ref={messageListRef}
            onScroll={handleMessageListScroll}
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-y-contain px-4 py-4",
              isMbl && mobileLayoutEnabled && showScrollToBottom && "pb-12",
            )}
          >
            {messagesError && (
              <p className="text-meta text-red-500">{messagesError}</p>
            )}
            {(sessionLoading || (!messages && !messagesError)) && (
              <p className="text-meta text-text-light-gray">Loading chat…</p>
            )}
            {messages && visibleFeed.length === 0 && (
              <p className="text-meta text-text-light-gray">
                {emptyFeedText(activeFeedFilter, selectedAgent.displayName)}
              </p>
            )}
            {visibleFeed.map((item: any) =>
              item.kind === "message" ? (
                <MessageBubble
                  key={item.id}
                  message={item}
                  projectIdForPrefix={projectIdForPrefix}
                  onProposalAction={handleProposalAction}
                  pending={sending && item.id.startsWith("optimistic-")}
                />
              ) : (
                <ActivityGroup
                  key={item.id}
                  group={item}
                  constrainRows={isMbl && mobileLayoutEnabled}
                />
              ),
            )}
            {/* Not a copy of QueuedMessagesStrip: behind the flag a queued message
                is a cancellable bubble in the thread, not a strip above the
                composer. The strip goes when the flag does. */}
            {chatStopAndTimeoutEnabled && activeFeedFilter !== "activity" &&
              queuedMessages.map((item: any) => (
                <div key={item.id} className="flex flex-col items-end">
                  <div className="max-w-[80%] rounded-[4px] bg-shadcn-primary px-3 py-2 text-dense text-primary-foreground whitespace-pre-wrap break-words opacity-70">
                    {item.content}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-micro text-text-light-gray">
                    <span className="font-semibold uppercase tracking-wide">Queued</span>
                    <button type="button" onClick={() => removeQueuedMessage(item.id)} className="hover:text-white-black" aria-label="Cancel queued message">Cancel</button>
                  </div>
                </div>
              ))}
            {awaiting && activeFeedFilter !== "activity" && !deliveryNotice && (
              <div
                className="flex items-center gap-2 text-meta text-text-light-gray"
                role="status"
              >
                {replyTimedOut ? (
                  <span>no reply, error logged</span>
                ) : (
                  <>
                    <TypingIndicator />
                    <span>{selectedAgent.displayName} is working</span>
                  </>
                )}
                {chatStopAndTimeoutEnabled && (
                  <button
                    type="button"
                    onClick={() => void handleStop()}
                    disabled={stopping}
                    className="font-medium hover:text-white-black disabled:opacity-50"
                  >
                    {stopping ? "Stopping…" : "Stop"}
                  </button>
                )}
              </div>
            )}
          </div>
          </div>
          <div
            className={cn(
              "relative shrink-0",
              !reuseAiComposer && "bg-cardBackground px-4 pb-4 pt-1",
            )}
          >
            {showScrollToBottom && isMbl && mobileLayoutEnabled && (
              <ScrollToBottomButton
                onClick={() => scrollMessagesToBottom("smooth")}
                className="-top-12 z-50"
              />
            )}
            {deliveryNotice && (
              <p className="mb-2 text-meta text-text-light-gray">
                This agent&apos;s runtime has not enabled chat yet.
              </p>
            )}
            {!chatStopAndTimeoutEnabled && queuedMessages.length > 0 && (
              <QueuedMessagesStrip
                items={queuedMessages}
                onRemove={removeQueuedMessage}
              />
            )}
            <div className="relative">
              {mentionOpen && (
                <div className="absolute bottom-full left-0 mb-1 max-h-[220px] w-[320px] overflow-y-auto rounded-[4px] bg-modalBackground py-1 shadow-md">
                  {mentionLoading ? (
                    <p className="px-3 py-2 text-meta text-text-light-gray">
                      Loading tasks…
                    </p>
                  ) : mentionLoadError ? (
                    <p className="px-3 py-2 text-meta text-text-light-gray">
                      Couldn&apos;t load tasks. Try searching again.
                    </p>
                  ) : mentionResults.length === 0 ? (
                    <p className="px-3 py-2 text-meta text-text-light-gray">
                      {mentionQuery?.trim() ? "No matching tasks" : "Type to search tasks"}
                    </p>
                  ) : (
                    mentionResults.map((task: any, i: number) => (
                      <button
                        key={task.id}
                        type="button"
                        onMouseEnter={() => setMentionIndex(i)}
                        onClick={() => pickMention(task)}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-dense",
                          i === mentionIndex ? "bg-hoverCardBackground" : "",
                        )}
                      >
                        <span className="shrink-0 text-text-light-gray">
                          {task.ticketNumber?.toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{task.title}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
              {reuseAiComposer ? (
                <AI_Tiptap_Container
                  controlledComposer={{
                    value: draft,
                    inputRef: composerRef,
                    editorRef: composerEditorRef,
                    useTiptapEditor: true,
                    onChange: handleComposerChange,
                    onKeyDown: handleComposerKeyDown,
                    placeholder: composerLocked
                      ? `${selectedAgent.displayName} is working -- this will queue`
                      : `Message ${selectedAgent.displayName}`,
                    ariaLabel: `Message ${selectedAgent.displayName}`,
                    isRecording,
                    isProcessing: isDictationProcessing,
                    onRecordingChange: setIsRecording,
                    onProcessingChange: setIsDictationProcessing,
                    onDictation: insertDictation,
                    dictationDisabled:
                      sending ||
                      ((mobileLayoutEnabled || mobileFullscreenFlag) &&
                        dictationProjectId === null),
                    projectId:
                      mobileLayoutEnabled || mobileFullscreenFlag
                        ? dictationProjectId
                        : undefined,
                    sendDisabled:
                      !draft.trim() ||
                      sending ||
                      isRecording ||
                      isDictationProcessing,
                    queueMode: composerLocked,
                    onSend: () => void handleSend(),
                  }}
                />
              ) : (
                <div className="relative flex items-end gap-2">
                  <textarea
                    ref={composerRef}
                    value={draft}
                    onChange={(e) =>
                      handleComposerChange(
                        e.target.value,
                        e.target.selectionStart ?? e.target.value.length,
                      )
                    }
                    onKeyDown={handleComposerKeyDown}
                    rows={2}
                    placeholder={
                      composerLocked
                        ? `${selectedAgent.displayName} is working -- this will queue`
                        : `Message ${selectedAgent.displayName}`
                    }
                    aria-label={`Message ${selectedAgent.displayName}`}
                    className="flex-1 resize-none rounded-[4px] bg-newcomment-well px-3 py-2 text-dense outline-none placeholder:text-text-light-gray disabled:opacity-50"
                  />
                  <AudioButton
                    id="agent-chat-audio-button"
                    editor={null}
                    callbackHandler={insertDictation}
                    toggleRecording={setIsRecording}
                    globalRecording={isRecording}
                    hasText={draft.trim().length > 0}
                    onProcessingChange={setIsDictationProcessing}
                    disabled={
                      sending ||
                      (isMbl && mobileLayoutEnabled && dictationProjectId === null)
                    }
                    projectId={
                      isMbl && mobileLayoutEnabled ? dictationProjectId : undefined
                    }
                    ariaLabel="Dictate message"
                    className="min-h-9 gap-1 rounded-[4px] px-2 text-text-light-gray hover:bg-hoverCardBackground"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={
                      !draft.trim() || sending || isRecording || isDictationProcessing
                    }
                    aria-label={composerLocked ? "Queue message" : "Send message"}
                    className={cn(
                      MOBILE_TARGET,
                      "rounded-[4px] bg-shadcn-primary text-primary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 px-3 text-dense font-medium",
                    )}
                  >
                    {composerLocked ? "Queue" : "Send"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  ) : (
    <section className="flex flex-1 items-center justify-center">
      <p className="text-dense text-text-light-gray">
        Select an agent to start chatting.
      </p>
    </section>
  );

const detailsSheetShown = Boolean(
    isNarrow && detailsSheetOpen && selectedAgent,
  );

useEffect(() => {
    const el = detailsDialogRef.current;
    // showModal() only works once the element is in the DOM, so this runs on
    // the commit that mounts it. Closing happens through close(), which fires
    // onClose and unmounts it.
    if (detailsSheetShown && el && !el.open) el.showModal();
  }, [detailsSheetShown]);

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

const closeCreateAgent = () => {
    if (creatingAgent) return;
    // A token is showing only right after a successful create; closing here
    // always means the user has seen it (or chose not to), never mid-request.
    setShowCreateAgent(false);
    setCreateAgentError(null);
    setNewAgentName("");
    setNewAgentToken(null);
    setTokenCopied(false);
  };

const copyNewAgentToken = async () => {
    if (!newAgentToken) return;
    try {
      await navigator.clipboard.writeText(newAgentToken);
      setTokenCopied(true);
    } catch {
      // Clipboard access can be blocked (permissions, insecure context); the
      // token stays selectable in the input either way.
    }
  };

const createAgentModal = showCreateAgent ? (
    <ModalContainerCustom
      id="create-agent-modal"
      isOpen={true}
      show={true}
      toggle={closeCreateAgent}
      // Once the one-time token is showing, an accidental outside click or
      // Escape press must not discard it: force the explicit Done/copy
      // affordance instead.
      shouldCloseOnClickOutside={!newAgentToken}
      keyboard={!newAgentToken}
      className="sm:min-w-[400px]"
    >
      <ModalHeaderComp header="Add agent" />
      <div className="px-6 pb-4">
        {newAgentToken ? (
          <>
            <p className="text-dense text-white-black">
              Agent created. Copy its token now, it will not be shown again.
            </p>
            <input
              readOnly
              value={newAgentToken}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Agent token"
              className="mt-2 w-full border-b border-light-black-border-1 bg-transparent px-0 py-1.5 text-meta text-white-black"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => void copyNewAgentToken()}
                className="rounded-[4px] px-3 py-1.5 text-dense text-text-light-gray hover:bg-hoverCardBackground"
              >
                {tokenCopied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={closeCreateAgent}
                className="rounded-[4px] bg-shadcn-primary px-3 py-1.5 text-dense font-medium text-primary-foreground hover:opacity-80"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <ModalInput
              value={newAgentName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewAgentName(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") void createAgent();
                if (e.key === "Escape") closeCreateAgent();
              }}
              placeholder="Agent name"
              aria-label="Agent name"
              className="border-b border-light-black-border-1 px-0"
            />
            {createAgentError && (
              <p className="mt-2 text-meta text-red-500">{createAgentError}</p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeCreateAgent}
                disabled={creatingAgent}
                className="rounded-[4px] px-3 py-1.5 text-dense text-text-light-gray hover:bg-hoverCardBackground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createAgent()}
                disabled={creatingAgent || !newAgentName.trim()}
                className="rounded-[4px] bg-shadcn-primary px-3 py-1.5 text-dense font-medium text-primary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingAgent ? "Creating…" : "Create"}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalContainerCustom>
  ) : null;

let mobileAgentChatHeight: string | undefined;

const mobileChromeAwareHeight = Boolean(
    isMbl &&
      (mobileLayoutEnabled ||
        mobileAgentChatViewportEnabled ||
        mobileFullscreenChrome),
  );

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
