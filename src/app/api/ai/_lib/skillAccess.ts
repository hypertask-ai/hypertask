import type { BoardKnowledgePrincipal } from "@/lib/rag/retrieveBoardKnowledge";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

import { assertProjectAccess } from "./customInstructions";

export class AccountSkillAccessError extends Error {
  readonly status = 403;
  constructor() { super("Account-global skills access denied"); }
}

export type SkillScope = "user" | "project";

export async function assertSkillScopeAccess(
  userId: number,
  scope: SkillScope,
  projectId?: number,
  principal?: BoardKnowledgePrincipal,
) {
  if (scope === "user") {
    if (principal?.teamScope != null) throw new AccountSkillAccessError();
    return { userId, projectId: null };
  }
  if (!projectId) throw new Error("projectId is required for project skills");
  await assertProjectAccess(userId, projectId, principal?.agentId, principal?.teamScope);
  return { userId: null, projectId };
}

export async function getAccessibleSkill(userId: number, id: number, principal?: BoardKnowledgePrincipal) {
  if (principal?.teamScope != null) {
    const global = await prisma.aI_Skill.findFirst({ where: { id, userId, projectId: null }, select: { id: true } });
    if (global) throw new AccountSkillAccessError();
  }
  const skill = await prisma.aI_Skill.findFirst({
    where: {
      id,
      OR: [
        ...(principal?.teamScope != null ? [] : [{ userId, projectId: null }]),
        {
          userId: null,
          project: { is: getProjectWhere(userId, principal?.agentId, principal?.teamScope) },
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
  const message = error instanceof Error ? error.message : "Skill request failed";
  const status = conflict ? 409 : message.includes("access denied") ? 403 : 400;
  return NextResponse.json(
    { error: conflict ? "A skill with this slug already exists in this scope" : message },
    { status }
  );
}
