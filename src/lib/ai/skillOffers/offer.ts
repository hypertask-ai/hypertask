import prisma from "@/lib/prisma";

import { skillOfferLink } from "./contract";
import { claimSkillOfferScan, createSkillOffer } from "./store";

export async function maybeOfferRepeatedInstruction(args: {
  userId: number;
  projectId: number | null | undefined;
  sessionId: string | null | undefined;
  actingAgentId?: string | null;
}): Promise<string | null> {
  try {
    const projectId = args.projectId;
    const sessionId = args.sessionId;
    if (!projectId || !sessionId || args.actingAgentId) return null;
    if (!(await claimSkillOfferScan(args.userId, projectId))) return null;

    const { detectRepeatedInstruction, loadInstructionSources } = await import("./detect");
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { teamId: true },
    });
    const sources = await loadInstructionSources(args.userId, projectId);
    const offer = await detectRepeatedInstruction({
      userId: args.userId,
      projectId,
      teamId: project?.teamId ?? null,
      sources,
    });
    if (!offer) return null;

    const record = await createSkillOffer({
      userId: args.userId,
      projectId,
      sessionId,
      offer,
    });
    return record ? skillOfferLink(record.id) : null;
  } catch (error) {
    console.error("[ai/skill-offers] offer skipped", error);
    return null;
  }
}
