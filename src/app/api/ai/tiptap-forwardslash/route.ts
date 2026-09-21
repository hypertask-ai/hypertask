import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";

import {
  createPromptForTiptapForwardSlash,
  errorMessage,
  extractHtmlBlocks,
  getCurrentUserFromCookies,
  normalizeTiptapOutput,
  reattachHtmlBlocks,
  selectTiptapModel,
} from "@/app/api/ai/_lib/editorAi";
import { getProjectTeamProviderContext } from "@/app/api/ai/_lib/providerGate";
import { isAiFeatureEnabled } from "@/lib/systemModelLadder";
import { resolveAiUsageTaskId } from "@/app/api/ai/_lib/currentTaskContext";
import { projectAccessWhere } from "@/app/api/ai/_lib/taskWriterRun";
import prisma from "@/lib/prisma";
import { tiptapForwardSlashRequestSchema } from "./requestSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const cookieUser = await getCurrentUserFromCookies();
  if (!cookieUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsedBody = tiptapForwardSlashRequestSchema.safeParse(
      await request.json()
    );
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Missing or invalid fields" },
        { status: 400 }
      );
    }
    const body = parsedBody.data;

    const project = body.projectId
      ? await prisma.project.findFirst({
          where: {
            id: body.projectId,
            ...projectAccessWhere(cookieUser.id),
          },
          select: { id: true },
        })
      : null;
    if (body.projectId && !project) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 403 },
      );
    }
    const usageProjectId = project?.id ?? null;
    const teamContext = await getProjectTeamProviderContext(
      usageProjectId,
      cookieUser.id,
    );
    const usageTaskId = await resolveAiUsageTaskId({
      taskId: body.taskId,
      projectId: usageProjectId,
      userId: cookieUser.id,
    });
    if (!isAiFeatureEnabled("improveWriting", teamContext.settings)) {
      return NextResponse.json(
        { error: "This AI feature is turned off for your team" },
        { status: 403 },
      );
    }

    // Spare HTML-canvas blocks from the AI edit: pull them out before the model
    // sees them, splice them back into the result. Otherwise the model drops the
    // opaque block and the slash command silently deletes the embedded HTML.
    const { stripped, blocks } = extractHtmlBlocks(body.content);

    const selected = await selectTiptapModel({
      projectId: usageProjectId,
      taskId: usageTaskId,
      userId: cookieUser.id,
      teamContext,
    });
    const { text } = await generateText({
      model: selected.model,
      instructions: createPromptForTiptapForwardSlash(
        body.command,
        stripped,
        body.instruction,
      ),
      prompt:
        body.command === "WriteContent"
          ? "Write the requested content."
          : `Follow the provided instructions for the following content: ${stripped}`,
      maxRetries: 2,
      providerOptions: selected.providerOptions,
      ...selected.settings,
    });

    return NextResponse.json(
      {
        corrected_html: reattachHtmlBlocks(
          normalizeTiptapOutput(stripped, text),
          blocks
        ),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[ai/tiptap-forwardslash] error", errorMessage(error));
    return NextResponse.json(
      { error: "An internal error occurred. Please try again later." },
      { status: 500 }
    );
  }
}
