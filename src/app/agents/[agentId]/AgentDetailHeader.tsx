"use client";

import AgentAvatar from "@/components/Agents/AgentAvatar";
import { cn } from "@/utils/undoActions/helperFuncs";
import Link from "next/link";
import WorkingSpinner from "../WorkingSpinner";
import { AgentSwitch, statusDotClass, statusWord } from "./AgentDetailParts";
import type { useAgentBoardAccess } from "./useAgentBoardAccess";
import type { useAgentConfig } from "./useAgentConfig";
import type { useAgentDetailLifecycle } from "./useAgentDetailLifecycle";
import type { useAgentDetailState } from "./useAgentDetailState";

type Props = Pick<
  ReturnType<typeof useAgentDetailState>,
  | "editingName"
  | "nameDraft"
  | "setNameDraft"
  | "setEditingName"
  | "savingName"
  | "openingChat"
  | "togglePending"
> &
  { agent: NonNullable<ReturnType<typeof useAgentDetailState>["agent"]> } &
  Pick<
  ReturnType<typeof useAgentBoardAccess>,
  | "working"
> &
  Pick<
  ReturnType<typeof useAgentConfig>,
  | "handleSaveName"
> &
  Pick<
  ReturnType<typeof useAgentDetailLifecycle>,
  | "handleOpenChat"
  | "handleToggle"
>;

export function AgentDetailHeader({
  agent, working, editingName, nameDraft, setNameDraft, handleSaveName, setEditingName,
  savingName, openingChat, handleOpenChat, handleToggle, togglePending,
}: Props) {
  return (
            <div
              // Wraps at every width: on a phone the actions drop to a second
              // line instead of squeezing the name to one letter (HTPR-6836).
              className="mt-4 flex flex-wrap items-center gap-3"
            >
              <AgentAvatar agentId={agent.id} name={agent.displayName} photoURL={agent.photoURL} size={34} className="text-[13px]" />
              {working ? (
                <WorkingSpinner label={`${agent.displayName} is working now`} />
              ) : (
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    statusDotClass[statusWord(agent)],
                  )}
                />
              )}
              {editingName ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => void handleSaveName()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  disabled={savingName}
                  aria-label="Agent name"
                  // Borderless, like every other input here: the house style is
                  // no boxes, and the field already reads as the title it edits.
                  className="text-[20px] font-semibold bg-transparent outline-none min-w-0 flex-1"
                />
              ) : (
                <h1
                  className="text-[20px] font-semibold truncate max-w-full cursor-text"
                  title="Click to rename"
                  onClick={() => {
                    setNameDraft(agent.displayName);
                    setEditingName(true);
                  }}
                >
                  {agent.displayName}
                </h1>
              )}
              <span className="flex-1" />
              {/* The two actions the manage modal used to carry: a native
                  agent is talked to in chat, an external one reports through
                  its inbox. Same split as the modal's row buttons. */}
              {agent.runtimeType === "NATIVE" ? (
                <button
                  type="button"
                  disabled={openingChat}
                  onClick={() => void handleOpenChat()}
                  className="text-[13px] text-hypertasks-purple disabled:opacity-50"
                >
                  {openingChat ? "Opening…" : "Chat"}
                </button>
              ) : (
                <Link
                  href={`/inbox/agent/${agent.id}`}
                  className="text-[13px] text-hypertasks-purple"
                >
                  Inbox
                </Link>
              )}
              <span className="text-[13px] text-text-light-gray">
                {working ? "Working" : statusWord(agent)}
              </span>
              <span
                className="text-[13px] text-text-light-gray"
                title="Tickets currently assigned to this agent"
              >
                {agent.operations.counts.assigned} assigned ticket
                {agent.operations.counts.assigned === 1 ? "" : "s"}
              </span>
              <AgentSwitch
                on={!agent.revokedAt}
                displayName={agent.displayName}
                onToggle={() => void handleToggle()}
                pending={togglePending}
              />
            </div>
  );
}
