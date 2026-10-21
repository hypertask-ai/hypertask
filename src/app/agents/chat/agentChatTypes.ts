"use client";

import { type SerializedChatTicketProposal } from "@/lib/agents/chatTicketProposal";
import { IProject, IUser } from "@/models/model";
export const AWAITING_POLL_MS = 4000;
export const ACTIVITY_POLL_MS = 5000;
export const CHAT_AVAILABILITY_POLL_MS = 30_000;
export const AWAITING_POLL_MAX_MS = 3 * 60 * 1000;
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


export const EMPTY_PROJECTS: IProject[] = [];
