"use client";

import AgentAvatar from "@/components/Agents/AgentAvatar";
import { AI_Tiptap_Container } from "@/components/AI_CHAT/AI_Tiptap_Container";
import { TypingIndicator } from "@/components/AI_CHAT/TypingIndicator";
import { AudioButton } from "@/components/RTE/Components/AudioButton";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { cn } from "@/utils/undoActions/helperFuncs";
import { ArrowLeft, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { ActivityGroup, chatStatusText, emptyFeedText, FeedFilter, MessageBubble, ScrollToBottomButton } from "./AgentChatFeedItems";
import type { useAgentChatComposer } from "./useAgentChatComposer";
import type { useAgentChatFeed } from "./useAgentChatFeed";
import type { useAgentChatNavigation } from "./useAgentChatNavigation";
import type { useAgentChatRoster } from "./useAgentChatRoster";
import type { useAgentChatSend } from "./useAgentChatSend";
import type { useAgentChatSession } from "./useAgentChatSession";
import type { useAgentChatState } from "./useAgentChatState";
import type { useAgentLifecycle } from "./useAgentLifecycle";

type Props = Pick<
  ReturnType<typeof useAgentChatNavigation>,
  | "selectedAgent"
  | "mobileFullscreenChrome"
  | "isExternal"
  | "reuseAiComposer"
  | "dictationProjectId"
> &
  Pick<
  ReturnType<typeof useAgentChatState>,
  | "isNarrow"
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
> &
  Pick<
  ReturnType<typeof useAgentLifecycle>,
  | "backToRoster"
  | "toggleDetails"
  | "handleOpenFullChat"
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
  ReturnType<typeof useAgentChatRoster>,
  | "projectIdForPrefix"
> &
  Pick<
  ReturnType<typeof useAgentChatSession>,
  | "handleProposalAction"
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
>;

export function AgentChatPane({
  selectedAgent, isNarrow, backToRoster, mobileFullscreenChrome, pollingChatEnabled, deliveryMode,
  toggleDetails, detailsCollapsed, setDetailsSheetOpen, isExternal, openingFullChat,
  handleOpenFullChat, activityRowsEnabled, feedFilter, setFeedFilter, showScrollToBottom, isMbl,
  mobileLayoutEnabled, scrollMessagesToBottom, messageListRef, handleMessageListScroll,
  messagesError, sessionLoading, messages, visibleFeed, activeFeedFilter, projectIdForPrefix,
  handleProposalAction, sending, queuedMessages, removeQueuedMessage,
  awaiting, deliveryNotice, replyTimedOut, handleStop, stopping, reuseAiComposer, mentionOpen,
  mentionLoading, mentionLoadError, mentionResults, mentionQuery, setMentionIndex, pickMention,
  mentionIndex, draft, composerRef, composerEditorRef, handleComposerChange, handleComposerKeyDown,
  composerLocked, isDictationProcessing, setIsRecording, setIsDictationProcessing, insertDictation,
  mobileFullscreenFlag, dictationProjectId, isRecording, handleSend,
}: Props) {
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
            {visibleFeed.map((item) =>
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
            {/* A queued message is a cancellable bubble in the thread, not a strip above the composer. */}
            {activeFeedFilter !== "activity" &&
              queuedMessages.map((item) => (
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
                <button
                  type="button"
                  onClick={() => void handleStop()}
                  disabled={stopping}
                  className="font-medium hover:text-white-black disabled:opacity-50"
                >
                  {stopping ? "Stopping…" : "Stop"}
                </button>
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
                    mentionResults.map((task, i) => (
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

  return chatPane;
}
