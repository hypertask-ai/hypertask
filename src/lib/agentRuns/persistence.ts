import type { AgentRun, Prisma } from "@prisma/client";
import {
  AgentRunNotActiveError,
  AgentRunSelectionConflictError,
  NONTERMINAL_AGENT_RUN_STATUSES,
  type AgentRunActivityInput,
  type AgentRunActivityOption,
  type AgentRunContext,
} from "./model";

type AgentRunActivityTransaction = Pick<
  Prisma.TransactionClient,
  "agentRun" | "agentRunActivity"
>;

export type AgentRunActivityPersistenceInput = AgentRunActivityInput & {
  id: string;
  runId: string;
  agentId: string;
  context: AgentRunContext;
  idempotencyKey: string | null;
  createdAt: Date;
};

async function recordRunHeartbeat(
  tx: AgentRunActivityTransaction,
  input: {
    runId: string;
    agentId: string;
    context: AgentRunContext;
    at: Date;
  },
) {
  let heartbeat = await tx.agentRun.updateMany({
    where: {
      id: input.runId,
      agentId: input.agentId,
      ...input.context,
      status: { in: NONTERMINAL_AGENT_RUN_STATUSES },
      lastActivityAt: { lte: input.at },
    },
    data: { status: "ACTIVE", lastActivityAt: input.at },
  });
  if (heartbeat.count === 0) {
    // Lock a run whose newer heartbeat already won without moving its clock back.
    heartbeat = await tx.agentRun.updateMany({
      where: {
        id: input.runId,
        agentId: input.agentId,
        ...input.context,
        status: { in: NONTERMINAL_AGENT_RUN_STATUSES },
      },
      data: { status: "ACTIVE" },
    });
  }
  if (heartbeat.count !== 1) {
    throw new AgentRunNotActiveError("Run is no longer active");
  }
}

export async function persistAgentRunActivity(
  tx: AgentRunActivityTransaction,
  input: AgentRunActivityPersistenceInput,
) {
  await recordRunHeartbeat(tx, {
    runId: input.runId,
    agentId: input.agentId,
    context: input.context,
    at: input.createdAt,
  });

  return tx.agentRunActivity.create({
    data: {
      id: input.id,
      runId: input.runId,
      type: input.type,
      text: input.text,
      link: input.link,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.createdAt,
      ...(input.options
        ? { options: input.options as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });
}

export type AgentRunSelectionPersistenceInput = {
  runId: string;
  agentId: string;
  activityId: string;
  context: AgentRunContext;
  option: AgentRunActivityOption;
  selectedById: number;
  selectedAt: Date;
};

export async function persistAgentRunSelection(
  tx: AgentRunActivityTransaction,
  input: AgentRunSelectionPersistenceInput,
): Promise<AgentRun> {
  await recordRunHeartbeat(tx, {
    runId: input.runId,
    agentId: input.agentId,
    context: input.context,
    at: input.selectedAt,
  });

  const selection = await tx.agentRunActivity.updateMany({
    where: {
      id: input.activityId,
      runId: input.runId,
      type: "ELICITATION",
      selectedAt: null,
    },
    data: {
      selectedValue: input.option.value,
      selectedLabel: input.option.label,
      selectedAt: input.selectedAt,
      selectedById: input.selectedById,
    },
  });
  if (selection.count !== 1) {
    throw new AgentRunSelectionConflictError(
      "This elicitation already has a selection",
    );
  }

  const run = await tx.agentRun.findFirst({
    where: {
      id: input.runId,
      agentId: input.agentId,
      agent: { userId: input.selectedById },
      ...input.context,
    },
  });
  if (!run) throw new AgentRunNotActiveError("Run is no longer available");
  return run;
}
