import "server-only";
import prisma from "@/lib/prisma";
import { computeBoard3Tasks7dV1, type ActivationFacts } from "./activationMetric";

export async function loadActivationFacts(userId: number): Promise<ActivationFacts | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { joinedAt: true } });
  if (!user) return null;
  const window = { gte: user.joinedAt, lt: new Date(user.joinedAt.getTime() + 7 * 24 * 60 * 60 * 1000) };
  const boards = await prisma.project.findMany({
    where: { ownerId: userId, seeded: false, createdAt: window },
    select: { id: true, ownerId: true, seeded: true, createdAt: true, teamId: true },
    orderBy: { id: "asc" },
  });
  const tasks = boards.length ? await prisma.task.findMany({
    where: { projectId: { in: boards.map((board) => board.id) }, createdAt: window },
    select: { id: true, projectId: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  }) : [];
  return { userId, signupAt: user.joinedAt, boards, tasks };
}

export async function computeActivationForUser(userId: number) {
  const facts = await loadActivationFacts(userId);
  return facts ? computeBoard3Tasks7dV1(facts) : null;
}
