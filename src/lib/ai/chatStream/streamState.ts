

import type { AiChatTurnOutcome } from "@/lib/telemetry/aiChatObservability";
import { acquireAiChatStreamLease, createTurnDeadline } from "@/app/api/ai/chat/stream/streamLease";
import type { decodeHeartbeatTurnMessage } from "@/lib/nativeAgent/heartbeatTurnEnvelope";
import type { ChatRequest, SendSse } from "./request";
import type { AuthedUser } from "./types";
import type { loadTurnModel } from "./turnModel";

type TurnModel = Exclude<Awaited<ReturnType<typeof loadTurnModel>>, Response>;
export type StreamOptions = TurnModel & {
  body: ChatRequest;
  dbUser: AuthedUser;
  requestMessage: string;
  heartbeatExecutionId: string | null;
  heartbeatTurn: ReturnType<typeof decodeHeartbeatTurnMessage>;
  turnDeadlineEnabled: boolean;
  aiObservabilityEnabled: boolean;
  userMessagePersisted: boolean;
  contextTaskId: number | null;
  streamId: string;
  streamLease: Exclude<Awaited<ReturnType<typeof acquireAiChatStreamLease>>, string>;
  heartbeatExecutionTerminal: boolean;
  firstTurn: boolean;
  turnStartedAtMs: number;
  maxDuration: number;
};

export type StreamState = StreamOptions & {
  encoder: TextEncoder;
  clientConnected: boolean;
  doneSent: boolean;
  errorSent: boolean;
  cancelled: boolean;
  providerAbort: AbortController;
  turnDeadlineHit: boolean;
  turnDeadline: ReturnType<typeof createTurnDeadline> | null;
  endDeadlineTurn: () => Promise<void>;
  send: SendSse;
  finish: (status: "complete" | "error", data?: Record<string, unknown>) => void;
  generationStartedAt: number;
  observedAgentId: string | null;
  observedModel: string;
  observedProvider: string;
  turnUsage: { inputTokens?: number; outputTokens?: number } | undefined;
  generationFinishedWithError: boolean;
  turnOutcomeRecorded: boolean;
  recordTurnOutcome: (outcome: AiChatTurnOutcome, error?: unknown) => void;
};
