"use client";

import { type SerializedChatTicketProposal } from "@/lib/agents/chatTicketProposal";
import { IProject, IUser } from "@/models/model";
// While we are waiting for an external agent to answer, the only way to see
// the reply arrive is to keep asking.
export const AWAITING_POLL_MS = 4000;
// The passive activity feed has no realtime channel of its own, so it needs a
// poll of its own to meet the 10-second freshness the ticket asks for.
export const ACTIVITY_POLL_MS = 5000;
// Availability changes without a chat event when a runtime heartbeat starts
// or expires, so idle chats need a low-frequency refresh of their own.
export const CHAT_AVAILABILITY_POLL_MS = 30_000;
// Realtime still refetches when the reply lands; the interval is only a
// fallback. Polling chat surfaces a generic failure after this bound.
export const AWAITING_POLL_MAX_MS = 3 * 60 * 1000;
export const LEGACY_AWAITING_POLL_MAX_MS = 15 * 60 * 1000;
export const MAX_MESSAGE_LENGTH = 8000;
export const DETAILS_COLLAPSED_KEY = "agentChat.detailsCollapsed";

export type TChatMessage = {
  id: string;
  role: "human" | "assistant" | "system";
  content: string;
  createdAt: string;
  proposal?: SerializedChatTicketProposal | null;
};

export type TProposalAction = (
  proposalId: string,
  action: "confirm" | "dismiss",
) => Promise<void>;

export type TAgentChatSession = { id: string; agentId: string };
export interface IProp {
  currentUser: IUser;
  roomsEnabled: boolean;
}

// Stable reference so the "@" mention effect below does not see a new

export const EMPTY_PROJECTS: IProject[] = [];
