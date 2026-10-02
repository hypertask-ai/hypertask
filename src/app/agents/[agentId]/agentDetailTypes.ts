"use client";

import type { TAgentBoardAccess } from "@/lib/agents/boardAccess";
import type { AgentRuntimeHealth, AgentRuntimeQueueItem, AgentRuntimeSnapshot, } from "@/lib/agents/runtimeState";
import { IUser } from "@/models/model";
import type { TAgent } from "../AgentsRegister";
export type TActivityKind = "comment" | "evidence" | "question" | "session" | "model";

export type TActivityItem = {
  id: string;
  at: string;
  kind: TActivityKind;
  did: string;
  detail: string | null;
  task: { id: number; title: string; url: string } | null;
  tokens: number | null;
};

export type TAgentOperations = {
  source: "runtime" | "inferred";
  health: AgentRuntimeHealth;
  snapshot: AgentRuntimeSnapshot | null;
  queue: AgentRuntimeQueueItem[];
  sourceBreakdown: Array<{
    boardId: number;
    section: string;
    eligible: number;
  }>;
  counts: {
    sourceTotal: number | null;
    eligiblePool: number | null;
    workerQueue: number;
    assigned: number;
    unowned: number;
    specialistOwned: number;
    processedUnowned: number;
    directMentions: number;
  };
};

export type TDetailAgent = TAgent & {
  operations: TAgentOperations;
  boardAccess: TAgentBoardAccess[];
};

export const PROMPT_MAX = 8000;
export const PROMPT_WARN = 7000;
// Same cadence as the register, so the two surfaces agree about what an agent
// is doing rather than one lagging the other by minutes.
export const POLL_MS = 30_000;
export interface IProp {
  agentId: string;
  currentUser: IUser;
  // Embedded inside another surface (Agent Chat details pane): the fixed
  // global rail would overlay the host layout there, and the screen-height
  // root would fight the host's scrolling container.
  embedded?: boolean;
}
