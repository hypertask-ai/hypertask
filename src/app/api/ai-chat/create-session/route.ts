import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const createSessionSchema = z.object({
  taskId: z.coerce.number().int().positive().optional(),
  agentId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const userId = (await getSessionUser(request.headers))?.userId;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = createSessionSchema.safeParse(
      await request.json().catch(() => ({}))
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid task ID" },
        { status: 400 }
      );
    }

    if (parsed.data.agentId) {
      const agent = await prisma.agent.findFirst({
        where: {
          id: parsed.data.agentId,
          userId: userId,
          revokedAt: null,
        },
        select: { id: true, displayName: true },
      });
      if (!agent) {
        return NextResponse.json(
          { error: "Agent not found" },
          { status: 404 }
        );
      }

      // One ongoing thread per agent, like a DM. A `(userId, agentId)` unique
      // constraint backs this upsert, so two concurrent "open this agent's
      // chat" requests converge on the same row instead of forking two
      // sessions -- a plain findFirst-then-create has a race window here.
      const session = await prisma.chatSession.upsert({
        where: { userId_agentId: { userId: userId, agentId: agent.id } },
        update: {},
        create: { userId: userId, agentId: agent.id, title: agent.displayName },
        select: { id: true },
      });
      return NextResponse.json({ success: true, session }, { status: 200 });
    }

    const session = await prisma.chatSession.create({
      data: {
        userId: userId,
        taskId: parsed.data.taskId,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    return NextResponse.json({ success: true, session }, { status: 200 });
  } catch (error: any) {
    console.error("🚀 ~ POST ~ Error creating chat session", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to create chat session",
      },
      { status: 500 }
    );
  }
}
