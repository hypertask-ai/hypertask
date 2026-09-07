import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

import { assertProjectAccess } from "./customInstructions";
import { SkillImportDisabledError } from "./skillImport";

export type SkillScope = "user" | "project";

export async function assertSkillScopeAccess(
  userId: number,
  scope: SkillScope,
  projectId?: number
) {
  if (scope === "user") return { userId, projectId: null };
  if (!projectId) throw new Error("projectId is required for project skills");
  await assertProjectAccess(userId, projectId);
  return { userId: null, projectId };
}

export async function getAccessibleSkill(userId: number, id: number) {
  const skill = await prisma.aI_Skill.findFirst({
    where: {
      id,
      OR: [
        { userId, projectId: null },
        {
          userId: null,
          project: { is: getProjectWhere(userId) },
        },
      ],
    },
  });
  if (!skill) throw new Error("Skill not found or access denied");
  return skill;
}

export function skillErrorResponse(error: unknown) {
  const conflict =
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  const disabled = error instanceof SkillImportDisabledError;
  const message = error instanceof Error ? error.message : "Skill request failed";
  let status = 400;
  if (conflict) status = 409;
  else if (disabled) status = 404;
  return NextResponse.json(
    { error: conflict ? "A skill with this slug already exists in this scope" : message },
    { status }
  );
}
