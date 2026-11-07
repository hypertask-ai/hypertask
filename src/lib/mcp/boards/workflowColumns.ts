import { HTPR_8900_CI_BLOCKER_WRITE_FLAG } from "@/lib/flags/definitions/htpr-8900-ci-blocker-write";
import { isFeatureEnabled } from "@/lib/flags";
import prisma from "@/lib/prisma";
import { enqueueColumnCreated, processAnalyticsIntentSoon } from "@/lib/telemetry/savedWork";
import { missingWorkflowColumns } from "./columnRole";

const FLEET_CI_PROJECT_ID = 11514;

const WORKFLOW_RANKING: Record<string, string> = {
  Blocked: "A0330",
  QA: "A0505",
  Release: "A0525",
};

export async function ciBlockerWriteOpen(userId: number): Promise<boolean> {
  try {
    return await isFeatureEnabled(HTPR_8900_CI_BLOCKER_WRITE_FLAG, userId);
  } catch {
    return false;
  }
}

export async function ensureFleetCiWorkflowColumns(projectId: number, userId: number, db = prisma): Promise<void> {
  if (projectId !== FLEET_CI_PROJECT_ID) return;
  if (!(await ciBlockerWriteOpen(userId))) return;
  try {
    const recorded = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
      const existing = await tx.section.findMany({
        where: { projectId, deleted: false },
        select: { section_title: true },
      });
      const keys: string[] = [];
      for (const title of missingWorkflowColumns(existing.map((section) => section.section_title))) {
        const section = await tx.section.create({
          data: {
            section_title: title,
            projectId,
            visibility: true,
            deleted: false,
            ranking: WORKFLOW_RANKING[title],
            isDone: false,
          },
        });
        keys.push(await enqueueColumnCreated(tx, section.id, { userId }));
      }
      return keys;
    });
    for (const key of recorded) processAnalyticsIntentSoon(key);
  } catch {
    return;
  }
}
