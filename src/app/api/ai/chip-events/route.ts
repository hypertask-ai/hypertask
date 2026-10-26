import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUserFromCookies } from "@/app/api/ai/_lib/editorAi";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { AI_CHIP_EVENTS, AI_CHIP_MAX_CHIPS, AI_CHIP_SURFACES, AI_CHIP_TEXT_LIMIT, AI_CHIP_TYPES } from "@/lib/ai/chipEvents";
import { HTPR_7978_AI_CHIP_EVENTS_FLAG, isFeatureEnabled } from "@/lib/flags";
import prisma from "@/lib/prisma";
import { recordAiChipEvent } from "@/lib/telemetry/aiChatObservability";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = z.string().max(AI_CHIP_TEXT_LIMIT);

const chipEventSchema = z.object({
  event: z.enum(AI_CHIP_EVENTS),
  surface: z.enum(AI_CHIP_SURFACES),
  chipType: z.enum(AI_CHIP_TYPES),
  chips: z.array(text).max(AI_CHIP_MAX_CHIPS),
  chipIndex: z.number().int().min(-1).max(AI_CHIP_MAX_CHIPS).optional(),
  chipText: text.optional(),
  typedText: text.optional(),
  typedLength: z.number().int().min(0).max(1_000_000).optional(),
  projectId: z.number().int().positive().nullish(),
  taskId: z.number().int().positive().nullish(),
});

export async function POST(request: NextRequest) {
  const viewer = await getCurrentUserFromCookies();
  if (!viewer?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isFeatureEnabled(HTPR_7978_AI_CHIP_EVENTS_FLAG, viewer.id)) return new NextResponse(null, { status: 204 });

  const parsed = chipEventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const actingAgentId = (await getSessionUser(request.headers))?.agentId;
  let projectId: number | null = null;
  let taskId: number | null = null;
  if (parsed.data.taskId) {
    const task = await prisma.task.findFirst({ where: { id: parsed.data.taskId, project: getProjectWhere(viewer.id, actingAgentId) }, select: { id: true, projectId: true } });
    if (task) {
      taskId = task.id;
      projectId = task.projectId;
    }
  } else if (parsed.data.projectId) {
    const project = await prisma.project.findFirst({ where: { id: parsed.data.projectId, AND: [getProjectWhere(viewer.id, actingAgentId)] }, select: { id: true } });
    projectId = project?.id ?? null;
  }

  await recordAiChipEvent({
    userId: viewer.id,
    event: parsed.data.event,
    surface: parsed.data.surface,
    chipType: parsed.data.chipType,
    chips: parsed.data.chips,
    chipIndex: parsed.data.chipIndex,
    chipText: parsed.data.chipText,
    typedText: parsed.data.typedText,
    typedLength: parsed.data.typedLength,
    projectId,
    taskId,
  });
  return new NextResponse(null, { status: 204 });
}
