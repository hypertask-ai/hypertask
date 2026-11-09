import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7779_SKILL_OFFERS_FLAG } from "@/lib/flags/definitions/htpr-7779-skill-offers";
import prisma from "@/lib/prisma";

import { skillOfferLink, SKILL_OFFER_MIN_OCCURRENCES } from "./contract";
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
    if (!(await isFeatureEnabled(HTPR_7779_SKILL_OFFERS_FLAG, args.userId))) return null;

    const { detectRepeatedInstruction, loadInstructionSources } = await import("./detect");
    const sources = await loadInstructionSources(args.userId, projectId);
    if (sources.length < SKILL_OFFER_MIN_OCCURRENCES) return null;
    if (!(await claimSkillOfferScan(args.userId, projectId))) return null;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { teamId: true },
    });
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
