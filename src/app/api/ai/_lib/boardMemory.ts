import { resolveAiModel as resolveLegacyAiModel } from "@/app/api/ai/_lib/modelProvider";
import { defaultModelKeyFor } from "@/lib/aiModelOptions";
import { getAiDefaultModelContext, resolveAutomaticAiModel } from "@/app/api/ai/_lib/byokKeys";
import { configureAiModelUsage } from "@/app/api/ai/_lib/modelProvider";
import { renderPrompt } from "@/lib/ai/prompts/registry";
import { generateObject } from "ai";
import { z } from "zod";

import { getByokOrTeamGatewayApiKeyForProvider } from "@/app/api/ai/_lib/byokKeys";
import {
  assertProjectAccess,
  ProjectAccessError,
} from "@/app/api/ai/_lib/customInstructions";
import {
  aiUsageProviderForCredential,
  gatewayProviderOptionsForModel,
  type AiGatewayTags,
} from "@/app/api/ai/_lib/modelProvider";
import {
  BOARD_MEMORY_CONFIG_FILE_TYPE,
  BOARD_MEMORY_CONFIG_SOURCE,
  BOARD_MEMORY_FILE_TYPE,
  BOARD_MEMORY_MAX_FACT_LENGTH,
  BOARD_MEMORY_MAX_FACTS_PER_BOARD,
  BOARD_MEMORY_MAX_FACTS_PER_SIGNAL,
  boardMemorySourceForFact,
  isBoardMemoryFactRow,
  isBoardMemoryFactSource,
  normalizeLearnedMemoryFacts,
} from "@/app/api/ai/_lib/boardMemoryContract";
import {
  BoardMemoryBusyError,
  bumpBoardMemoryRevision,
  claimBoardMemorySignal,
  completeBoardMemorySignalClaim,
  getBoardMemoryRevision,
  releaseBoardMemorySignalClaim,
  withBoardMemoryLock,
} from "@/app/api/ai/_lib/boardMemoryGuards";
import {
  buildCustomInstructionFileRows,
  deleteCustomInstructionFileInTurbopuffer,
  listCustomInstructionFileRows,
  upsertCustomInstructionFileRowsToTurbopuffer,
} from "@/utils/controllers/turbopuffer/turbopufferHelper";

const BOARD_MEMORY_MODEL = "gpt-6-luna";
export { ProjectAccessError as BoardMemoryProjectAccessError };
const learnedFactsSchema = z.object({
  facts: z
    .array(z.string().trim().min(1).max(BOARD_MEMORY_MAX_FACT_LENGTH))
    .max(BOARD_MEMORY_MAX_FACTS_PER_SIGNAL),
});

export type BoardMemorySignal =
  | {
      type: "task_writer_correction";
      originalText: string;
      correctionText: string;
    }
  | {
      type: "edited_ai_title";
      originalText: string;
      correctedText: string;
    };

export type BoardMemoryEntry = {
  content: string;
  createdAt: string;
  source: string;
};

export async function getBoardMemoryState(userId: number, projectId: number) {
  await assertProjectAccess(userId, projectId);
  return loadBoardMemoryState(projectId);
}

async function loadBoardMemoryState(projectId: number) {
  const [configRows, memoryRows] = await Promise.all([
    listCustomInstructionFileRows({
      projectId,
      fileType: BOARD_MEMORY_CONFIG_FILE_TYPE,
      topK: 1,
    }),
    listCustomInstructionFileRows({
      projectId,
      fileType: BOARD_MEMORY_FILE_TYPE,
      topK: BOARD_MEMORY_MAX_FACTS_PER_BOARD,
    }),
  ]);

  return {
    enabled: configRows.some(
      (row) => row.source === BOARD_MEMORY_CONFIG_SOURCE,
    ),
    memories: memoryRows
      .filter((row) => row.chunkIndex === 0 && isBoardMemoryFactRow(row))
      .map<BoardMemoryEntry>((row) => ({
        content: row.content,
        createdAt: row.updatedAt,
        source: row.source,
      })),
  };
}

export async function setBoardMemoryEnabled(args: {
  enabled: boolean;
  projectId: number;
  userId: number;
}) {
  const project = await assertProjectAccess(args.userId, args.projectId);
  return withBoardMemoryLock(project.id, async (lease) => {
    await bumpBoardMemoryRevision(project.id);
    if (!args.enabled) {
      await lease.assertCurrent();
      await deleteCustomInstructionFileInTurbopuffer({
        projectId: project.id,
        source: BOARD_MEMORY_CONFIG_SOURCE,
      });
      return { enabled: false };
    }

    const rows = buildCustomInstructionFileRows({
      projectId: project.id,
      teamId: project.teamId ?? "",
      source: BOARD_MEMORY_CONFIG_SOURCE,
      fileName: "Board memory configuration",
      fileType: BOARD_MEMORY_CONFIG_FILE_TYPE,
      content: "enabled",
    });
    await writeBoardMemoryRows(rows, lease.assertCurrent);
    return { enabled: true };
  });
}

export async function deleteBoardMemory(args: {
  projectId: number;
  source: string;
  userId: number;
}) {
  await assertProjectAccess(args.userId, args.projectId);
  if (!isBoardMemoryFactSource(args.source)) {
    throw new Error("Invalid board memory source");
  }

  return withBoardMemoryLock(args.projectId, async (lease) => {
    await bumpBoardMemoryRevision(args.projectId);
    await lease.assertCurrent();
    await deleteCustomInstructionFileInTurbopuffer({
      projectId: args.projectId,
      source: args.source,
    });
    return { success: true };
  });
}

export async function learnBoardMemoryFromSignal(args: {
  projectId: number;
  signal: BoardMemorySignal;
  userId: number;
}) {
  const project = await assertProjectAccess(args.userId, args.projectId);
  const revisionBeforeInference = await getBoardMemoryRevision(project.id);
  const state = await loadBoardMemoryState(project.id);
  if ((await getBoardMemoryRevision(project.id)) !== revisionBeforeInference) {
    throw new BoardMemoryBusyError();
  }
  if (!state.enabled) {
    return { enabled: false, learned: [] as string[] };
  }
  if (state.memories.length >= BOARD_MEMORY_MAX_FACTS_PER_BOARD) {
    return { enabled: true, learned: [] as string[] };
  }
  const signalClaim = await claimBoardMemorySignal(args);
  if (signalClaim.status === "duplicate") {
    return { enabled: true, learned: [] as string[] };
  }
  try {
    const defaultContext = typeof getAiDefaultModelContext === "function" ? await getAiDefaultModelContext({ projectId: project.id, userId: args.userId }) : { haiku55Enabled: false, byok: undefined };
    const useHaiku = defaultModelKeyFor(defaultContext, BOARD_MEMORY_MODEL) === "claude-haiku-5-5";
    const provider = useHaiku ? defaultContext.byok?.provider === "openrouter" ? "openrouter" : "claude" : "openai";
    const gatewayApiKey = (useHaiku ? defaultContext.byok?.credential : undefined) ?? await getByokOrTeamGatewayApiKeyForProvider(
      provider,
      undefined,
      { projectId: project.id, userId: args.userId },
    );
    const model = defaultContext.haiku55Enabled ? resolveAutomaticAiModel(provider, useHaiku ? provider === "openrouter" ? "anthropic/claude-haiku-5.5" : "claude-haiku-5-5" : BOARD_MEMORY_MODEL, gatewayApiKey, { haiku55Enabled: defaultContext.haiku55Enabled, lookup: { projectId: project.id, userId: args.userId }, feature: "custom-instructions" }) : resolveLegacyAiModel("openai", BOARD_MEMORY_MODEL, gatewayApiKey);
    const gatewayTags: AiGatewayTags = {
      projectId: project.id,
      teamId: project.teamId ?? "",
      userId: args.userId,
    };
    configureAiModelUsage(model, {
      userId: args.userId,
      teamId: project.teamId,
      projectId: project.id,
      provider: aiUsageProviderForCredential(provider, gatewayApiKey),
      feature: "custom-instructions",
    });
    const result = await generateObject({
      model,
      schema: learnedFactsSchema,
      maxRetries: 2,
      maxOutputTokens: 500,
      providerOptions: gatewayProviderOptionsForModel(
        model,
        "custom-instructions",
        gatewayTags,
      ),
      system: renderPrompt("board-memory-system-1", (BOARD_MEMORY_MAX_FACTS_PER_SIGNAL)),
      prompt: JSON.stringify({
        existingMemories: state.memories.map((memory) => memory.content),
        signal: args.signal,
      }),
    });

    const learnedResult = await withBoardMemoryLock(
      project.id,
      async (lease) => {
        const [latestState, currentRevision] = await Promise.all([
          loadBoardMemoryState(project.id),
          getBoardMemoryRevision(project.id),
        ]);
        if (currentRevision !== revisionBeforeInference) {
          throw new BoardMemoryBusyError();
        }
        if (!latestState.enabled) {
          return { enabled: false, learned: [] as string[] };
        }

        const facts = normalizeLearnedMemoryFacts(
          result.object.facts,
          latestState.memories.map((memory) => memory.content),
        ).slice(
          0,
          BOARD_MEMORY_MAX_FACTS_PER_BOARD - latestState.memories.length,
        );
        if (facts.length === 0) {
          return { enabled: true, learned: facts };
        }

        const rows = facts.flatMap((fact) =>
          buildCustomInstructionFileRows({
            projectId: project.id,
            teamId: project.teamId ?? "",
            source: boardMemorySourceForFact(fact),
            fileName: "Board memory",
            fileType: BOARD_MEMORY_FILE_TYPE,
            content: fact,
          }),
        );
        await writeBoardMemoryRows(rows, lease.assertCurrent);
        return { enabled: true, learned: facts };
      },
    );
    await completeBoardMemorySignalClaim(args, signalClaim.token);
    return learnedResult;
  } catch (error) {
    await releaseBoardMemorySignalClaim(args, signalClaim.token);
    throw error;
  }
}

async function writeBoardMemoryRows(
  rows: ReturnType<typeof buildCustomInstructionFileRows>,
  beforeWrite?: () => Promise<void>,
) {
  const response = await upsertCustomInstructionFileRowsToTurbopuffer(rows, {
    beforeWrite,
  });
  if (!response) {
    throw new Error("Board memory storage is unavailable");
  }
}
