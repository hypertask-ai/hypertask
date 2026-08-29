import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { PriorityConstants } from "@/lib/constants/constants";
import {
  getCurrentUserFromCookies,
  errorMessage,
  selectTaskWriterModel,
} from "@/app/api/ai/_lib/editorAi";
import { isAiFeatureEnabled } from "@/lib/systemModelLadder";
import { validateBoardManifest } from "@/lib/mcp/boards/validateManifest";
import { createBoardFromManifest } from "@/lib/mcp/boards/createBoardFromManifest";
import {
  FREE_BOARD_LIMIT_MESSAGE,
  isBoardLimitReached,
} from "@/utils/controllers/projects/boardQuota";
import { createOnboardingSampleBoardProject } from "@/utils/controllers/users/completeOnboardingStep";
import {
  IdempotencyInProgressError,
  normalizeIdempotencyKey,
  withIdempotency,
} from "@/lib/mcp/idempotency/idempotencyStore";
import type { IUser } from "@/models/model";
import type { ValidatedBoardManifest } from "@/lib/mcp/boards/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const priorityValues = [
  "No Priority",
  "Urgent",
  "High",
  "Medium",
  "Low",
] as const;

const requestSchema = z.object({
  prompt: z.string().max(2000).optional().default(""),
  teamId: z.string().optional().nullable(),
  teamTitle: z.string().optional().nullable(),
  skipAi: z.boolean().optional().default(false),
});

const generatedBoardSchema = z.object({
  boardTitle: z.string().min(1).max(120),
  sections: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        tasks: z
          .array(
            z.object({
              title: z.string().min(1).max(160),
              // OpenAI strict structured outputs require every property to be required
              description: z.string().max(1000),
              priority: z.enum(priorityValues),
            })
          )
          .min(1)
          .max(6),
      })
    )
    .min(3)
    .max(5),
});

type GenerateBoardRequest = z.infer<typeof requestSchema>;
type GeneratedBoard = z.infer<typeof generatedBoardSchema>;

type DbUser = {
  id: number;
  email: string | null;
  displayName: string | null;
  accountId: string | null;
};

type ResolvedTeam = {
  id: string;
  title: string | null;
  googleAccountId: string;
  aiProviderSettings: unknown;
};

function cleanText(value: string | null | undefined, fallback: string, maxLength: number) {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

function priorityIndex(priority: string | undefined) {
  return (
    PriorityConstants.find((item) => item.Priority_Value === priority)
      ?.priority_index ?? 0
  );
}

async function resolveTeamForUser(
  user: DbUser,
  requestedTeamId?: string | null
): Promise<ResolvedTeam | null> {
  const select = {
    id: true,
    title: true,
    googleAccountId: true,
    aiProviderSettings: true,
  };
  const teamId = requestedTeamId?.trim();

  if (teamId) {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select,
    });
    if (!team) return null;

    const ownsTeam = user.accountId != null && user.accountId === team.googleAccountId;
    const membership = ownsTeam
      ? null
      : await prisma.member_Team.findFirst({
          where: {
            userId: user.id,
            teamId: team.id,
            status: "Accepted",
          },
          select: { id: true },
        });

    return ownsTeam || membership ? team : null;
  }

  const ownedTeam = await prisma.team.findFirst({
    where: {
      googleAccount: {
        userId: user.id,
      },
    },
    orderBy: { createdAt: "desc" },
    select,
  });
  if (ownedTeam) return ownedTeam;

  const membership = await prisma.member_Team.findFirst({
    where: {
      userId: user.id,
      status: "Accepted",
    },
    orderBy: { acceptedAt: "desc" },
    select: {
      team: {
        select,
      },
    },
  });

  return membership?.team ?? null;
}

async function selectOnboardingBoardModel(team: ResolvedTeam, userId: number) {
  return selectTaskWriterModel({
    teamId: team.id,
    userId,
    feature: "onboarding-board",
    aiFeature: "boardGeneration",
    teamContext: {
      teamId: team.id,
      settings: team.aiProviderSettings,
    },
  });
}

function toBoardManifest(generated: GeneratedBoard): ValidatedBoardManifest {
  const seenSectionTitles = new Set<string>();
  const sections = generated.sections.map((section, index) => {
    const baseTitle = cleanText(section.title, `Section ${index + 1}`, 80);
    const title = seenSectionTitles.has(baseTitle)
      ? `${baseTitle} ${index + 1}`.slice(0, 80)
      : baseTitle;
    seenSectionTitles.add(title);
    return { title };
  });

  const tasks = generated.sections.flatMap((section, sectionIndex) =>
    section.tasks.map((task) => ({
      title: cleanText(task.title, "Untitled task", 160),
      description: task.description?.trim() || undefined,
      section_index: sectionIndex,
      priority: priorityIndex(task.priority),
      estimate: 0,
    }))
  );

  if (tasks.length < 6) {
    throw new Error("Generated board did not include enough tasks");
  }

  const manifest = {
    title: cleanText(generated.boardTitle, "My Hypertask Board", 120),
    sections,
    labels: [],
    tasks: tasks.slice(0, 14),
  };

  const validated = validateBoardManifest(manifest);
  if (!validated.ok) {
    throw new Error(validated.message);
  }

  return validated.data;
}

async function generateBoardManifest({
  prompt,
  team,
  user,
  abortSignal,
}: {
  prompt: string;
  team: ResolvedTeam;
  user: DbUser;
  abortSignal: AbortSignal;
}) {
  const selected = await selectOnboardingBoardModel(team, user.id);
  const priorityList = priorityValues.join(", ");

  const { object } = await generateObject({
    model: selected.model,
    schema: generatedBoardSchema,
    maxRetries: 1,
    providerOptions: selected.providerOptions,
    abortSignal,
    ...selected.settings,
    system:
      "You create practical Hypertask kanban boards for a new user's stated workflow. Keep tasks concrete, actionable, and specific to the user's context. Use 3-5 sections and 6-14 total tasks.",
    prompt: `Team: ${team.title || "Untitled team"}
User goal: ${prompt}

Return a board with:
- 3 to 5 workflow sections.
- 6 to 14 total starter tasks.
- Task descriptions that explain the desired outcome in one or two sentences.
- Priorities using only these values: ${priorityList}.`,
  });

  return toBoardManifest(object);
}

async function createSampleBoard({
  user,
  team,
}: {
  user: DbUser;
  team: ResolvedTeam;
}) {
  return createOnboardingSampleBoardProject({
    exist_user: user as unknown as IUser,
    boardTitle: "Sample Board",
    Team: team,
    googleAccount: { id: team.googleAccountId },
  });
}

export async function POST(request: NextRequest) {
  const cookieUser = await getCurrentUserFromCookies();
  if (!cookieUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: GenerateBoardRequest;
  try {
    body = requestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: `Invalid request: ${errorMessage(error)}` },
      { status: 400 }
    );
  }

  let idempotencyKey: string | null;
  try {
    idempotencyKey = normalizeIdempotencyKey(
      request.headers.get("Idempotency-Key"),
    );
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: cookieUser.id },
    select: {
      id: true,
      email: true,
      displayName: true,
      accountId: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const team = await resolveTeamForUser(user, body.teamId);
  if (!team) {
    return NextResponse.json(
      { error: "No team available for board creation" },
      { status: 404 }
    );
  }

  const prompt = body.prompt.trim();
  if (!prompt && !body.skipAi) {
    return NextResponse.json(
      { error: "Prompt is required to generate a board" },
      { status: 400 }
    );
  }

  const produceBoard = async () => {
    // HTPR-4894: checked before both creation branches. The AI path's catch
    // falls back to createSampleBoard, which does not enforce this cap itself.
    if (await isBoardLimitReached(user.id)) {
      throw new BoardGenerationRequestError(403, FREE_BOARD_LIMIT_MESSAGE);
    }

    request.signal.throwIfAborted();

    if (body.skipAi) {
      const project = await createSampleBoard({ user, team });
      return {
        projectId: project.id,
        teamId: team.id,
        teamTitle: team.title,
        source: "sample",
      };
    }

    if (!isAiFeatureEnabled("boardGeneration", team.aiProviderSettings)) {
      throw new BoardGenerationRequestError(
        403,
        "This AI feature is turned off for your team",
      );
    }

    try {
      const manifest = await generateBoardManifest({
        prompt,
        team,
        user,
        abortSignal: request.signal,
      });
      request.signal.throwIfAborted();
      const result = await createBoardFromManifest({
        teamId: team.id,
        googleAccountId: team.googleAccountId,
        manifest,
        userId: user.id,
        userEmail: user.email || "",
        userDisplayName: user.displayName,
      });

      return {
        projectId: result.board.id,
        teamId: team.id,
        teamTitle: team.title,
        source: "ai",
      };
    } catch (error) {
      if (request.signal.aborted) throw error;
      console.error("[ai/generate-board] falling back to sample board", error);
      const project = await createSampleBoard({ user, team });
      return {
        projectId: project.id,
        teamId: team.id,
        teamTitle: team.title,
        source: "sample",
        fallbackReason: "ai_failed",
      };
    }
  };

  try {
    const responseBody = await withIdempotency(
      "generate_onboarding_board",
      user.id,
      idempotencyKey,
      { prompt, teamId: team.id, skipAi: body.skipAi },
      produceBoard,
    );
    return NextResponse.json(responseBody);
  } catch (error) {
    if (error instanceof IdempotencyInProgressError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof BoardGenerationRequestError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}

class BoardGenerationRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BoardGenerationRequestError";
  }
}
