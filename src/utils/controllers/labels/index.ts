import type { Prisma, PrismaClient } from "@prisma/client";

import prisma from "@/lib/prisma";

type LabelDatabase = Pick<PrismaClient | Prisma.TransactionClient, "label">;

export function labelStore(database: LabelDatabase = prisma) {
  return database.label;
}

export async function listProjectLabelOptions(projectId: number) {
  return labelStore().findMany({
    where: { projectId },
    select: { id: true, value: true },
    orderBy: { value: "asc" },
  });
}

export async function findProjectLabelByName(projectId: number, value: string) {
  return labelStore().findFirst({ where: { projectId, value } });
}

export async function createProjectLabel(
  projectId: number,
  value: string,
  aiPrompt: string | null = null,
) {
  return labelStore().create({
    data: { projectId, value, ai_prompt: aiPrompt },
  });
}
