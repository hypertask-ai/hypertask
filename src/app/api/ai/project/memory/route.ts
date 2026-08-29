import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  BoardMemoryProjectAccessError,
  deleteBoardMemory,
  getBoardMemoryState,
  learnBoardMemoryFromSignal,
  setBoardMemoryEnabled,
} from "@/app/api/ai/_lib/boardMemory";
import { getCurrentUserFromCookies } from "@/app/api/ai/_lib/editorAi";
import { isBoardMemoryFactSource } from "@/app/api/ai/_lib/boardMemoryContract";
import {
  BoardMemoryBusyError,
  BoardMemoryRateLimitError,
} from "@/app/api/ai/_lib/boardMemoryGuards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const projectIdSchema = z.coerce.number().int().positive();
const memorySourceSchema = z
  .string()
  .trim()
  .refine(isBoardMemoryFactSource, "Invalid board memory source");
const toggleSchema = z.object({
  enabled: z.boolean(),
  projectId: projectIdSchema,
});
const learnSchema = z.discriminatedUnion("type", [
  z.object({
    projectId: projectIdSchema,
    type: z.literal("task_writer_correction"),
    originalText: z.string().trim().min(1).max(20_000),
    correctionText: z.string().trim().min(1).max(2_000),
  }),
  z.object({
    projectId: projectIdSchema,
    type: z.literal("edited_ai_title"),
    originalText: z.string().trim().min(1).max(500),
    correctedText: z.string().trim().min(1).max(500),
  }),
]);

export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const projectId = projectIdSchema.parse(
      request.nextUrl.searchParams.get("projectId"),
    );
    return NextResponse.json(await getBoardMemoryState(userId, projectId));
  });
}

export async function PATCH(request: NextRequest) {
  return withUser(async (userId) => {
    const input = toggleSchema.parse(await request.json());
    return NextResponse.json(await setBoardMemoryEnabled({ ...input, userId }));
  });
}

export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const input = learnSchema.parse(await request.json());
    const { projectId, ...signal } = input;
    return NextResponse.json(
      await learnBoardMemoryFromSignal({ projectId, signal, userId }),
    );
  });
}

export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const projectId = projectIdSchema.parse(
      request.nextUrl.searchParams.get("projectId"),
    );
    const source = memorySourceSchema.parse(
      request.nextUrl.searchParams.get("source"),
    );
    return NextResponse.json(
      await deleteBoardMemory({ projectId, source, userId }),
    );
  });
}

async function withUser(handler: (userId: number) => Promise<NextResponse>) {
  try {
    const user = await getCurrentUserFromCookies();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return await handler(user.id);
  } catch (error) {
    if (error instanceof BoardMemoryRateLimitError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    }
    if (error instanceof BoardMemoryBusyError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: 503,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (error instanceof BoardMemoryProjectAccessError) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 },
      );
    }
    console.error("Board memory request failed", error);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}
