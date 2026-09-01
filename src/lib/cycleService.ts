import { Status, type Cycle, type Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { doneColumnTitles } from "@/lib/doneColumns";
import {
  CYCLE_WINDOW_SIZE,
  cycleEndFor,
  dateOnly,
  resolveCycleWindow,
  startOfUtcWeek,
  utcDate,
  type CycleSummary,
} from "@/lib/cycles";

const CYCLE_SWEEP_BATCH = 50;
const CYCLE_LOCK_NAMESPACE = 4367;

type CycleDb = Pick<Prisma.TransactionClient, "cycle" | "project">;
type RolloverCandidate = { projectId: number };

export class CycleAssignmentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message);
  }
}

const lockProjectCycles = async (tx: Prisma.TransactionClient, projectId: number) => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${CYCLE_LOCK_NAMESPACE}, ${projectId})`;
};

const nextCycleNumber = async (db: CycleDb, projectId: number): Promise<number> => {
  const aggregate = await db.cycle.aggregate({
    where: { projectId },
    _max: { number: true },
  });
  return (aggregate._max.number ?? 0) + 1;
};

const findOrCreateCycle = async (
  db: CycleDb,
  projectId: number,
  startDate: Date,
): Promise<Cycle> => {
  const existing = await db.cycle.findUnique({
    where: { projectId_startDate: { projectId, startDate } },
  });
  if (existing) return existing;

  return db.cycle.create({
    data: {
      projectId,
      number: await nextCycleNumber(db, projectId),
      startDate,
      endDate: cycleEndFor(startDate),
    },
  });
};

export const cycleJson = (cycle: CycleSummary | null) =>
  cycle
    ? {
        id: cycle.id,
        number: cycle.number,
        projectId: cycle.projectId,
        startDate: dateOnly(cycle.startDate),
        endDate: dateOnly(cycle.endDate),
        rolledOverAt: cycle.rolledOverAt ?? null,
      }
    : null;

export const getProjectCycleOverview = async (
  projectId: number,
  now: Date = new Date(),
  db: CycleDb = prisma,
) => {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { cyclesEnabled: true },
  });
  if (!project) return null;

  const today = utcDate(now);
  const cycles = await db.cycle.findMany({
    where: {
      projectId,
      endDate: { gt: today },
    },
    orderBy: { startDate: "asc" },
    take: CYCLE_WINDOW_SIZE,
  });
  const window = resolveCycleWindow(cycles, today);
  return {
    enabled: project.cyclesEnabled,
    current: cycleJson(window.current),
    next: cycleJson(window.next),
  };
};

export const assertCycleAssignable = async (
  tx: Prisma.TransactionClient,
  projectId: number,
  cycleId: number,
  now: Date = new Date(),
) => {
  await lockProjectCycles(tx, projectId);
  const overview = await getProjectCycleOverview(projectId, now, tx);
  if (!overview?.enabled) {
    throw new CycleAssignmentError("Cycles are disabled for this board", 409);
  }
  if (cycleId !== overview.current?.id && cycleId !== overview.next?.id) {
    throw new CycleAssignmentError("Only the current or next cycle can be assigned", 400);
  }
};

export const setProjectCyclesEnabled = async (
  projectId: number,
  enabled: boolean,
  now: Date = new Date(),
) => {
  await prisma.$transaction(async (tx) => {
    await lockProjectCycles(tx, projectId);
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) throw new Error("Board not found");

    if (!enabled) {
      await tx.project.update({ where: { id: projectId }, data: { cyclesEnabled: false } });
      return;
    }

    const today = utcDate(now);
    let current = await tx.cycle.findFirst({
      where: {
        projectId,
        startDate: { lte: today },
        endDate: { gt: today },
      },
      orderBy: { startDate: "desc" },
    });
    if (!current) {
      current = await findOrCreateCycle(tx, projectId, startOfUtcWeek(today));
    }

    await findOrCreateCycle(tx, projectId, utcDate(current.endDate));
    await tx.cycle.updateMany({
      where: {
        projectId,
        endDate: { lte: current.startDate },
        rolledOverAt: null,
      },
      data: { rolledOverAt: now },
    });
    await tx.project.update({ where: { id: projectId }, data: { cyclesEnabled: true } });
  });

  return getProjectCycleOverview(projectId, now);
};

const rolloverOneProjectCycle = async (
  projectId: number,
  now: Date,
): Promise<{ moved: number; rolled: boolean }> =>
  prisma.$transaction(async (tx) => {
    await lockProjectCycles(tx, projectId);
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { cyclesEnabled: true },
    });
    if (!project?.cyclesEnabled) return { moved: 0, rolled: false };

    const source = await tx.cycle.findFirst({
      where: {
        projectId,
        endDate: { lte: utcDate(now) },
        rolledOverAt: null,
      },
      orderBy: { endDate: "asc" },
    });
    if (!source) return { moved: 0, rolled: false };

    const claimed = await tx.cycle.updateMany({
      where: { id: source.id, projectId, rolledOverAt: null },
      data: { rolledOverAt: now },
    });
    if (claimed.count === 0) return { moved: 0, rolled: false };

    const destination = await findOrCreateCycle(tx, projectId, utcDate(source.endDate));
    await findOrCreateCycle(tx, projectId, utcDate(destination.endDate));

    const sections = await tx.section.findMany({
      where: { projectId, deleted: false },
      select: { id: true, section_title: true, isDone: true },
    });
    const doneTitles = doneColumnTitles(sections);
    const doneSections = sections.filter((section) =>
      doneTitles.has(section.section_title.trim().toLowerCase()),
    );
    const doneSectionIds = doneSections.map((section) => section.id);
    const doneSectionNames = doneSections.map((section) => section.section_title);

    const updated = await tx.task.updateMany({
      where: {
        projectId,
        cycleId: source.id,
        status: Status.Normal,
        assignees: { some: {} },
        ...(doneSectionIds.length > 0
          ? { OR: [{ sectionId: null }, { sectionId: { notIn: doneSectionIds } }] }
          : {}),
        ...(doneSectionNames.length > 0 ? { section: { notIn: doneSectionNames } } : {}),
      },
      data: { cycleId: destination.id, updatedAt: now },
    });

    return { moved: updated.count, rolled: true };
  });

export const sweepCycleRollovers = async (
  now: Date = new Date(),
  limit: number = CYCLE_SWEEP_BATCH,
): Promise<number> => {
  const batch = Math.max(1, Math.min(limit, CYCLE_SWEEP_BATCH));
  const candidates = await prisma.$queryRaw<RolloverCandidate[]>`
    SELECT c."projectId"
    FROM "Cycle" c
    JOIN "Project" p ON p.id = c."projectId"
    WHERE p."cyclesEnabled" = true
      AND c."rolledOverAt" IS NULL
      AND c."endDate" <= ${utcDate(now)}
    ORDER BY c."endDate" ASC
    LIMIT ${batch}
  `;

  let moved = 0;
  const touchedProjects = new Set<number>();
  for (const candidate of candidates) {
    try {
      const result = await rolloverOneProjectCycle(candidate.projectId, now);
      moved += result.moved;
      if (result.rolled) touchedProjects.add(candidate.projectId);
    } catch (error) {
      console.error("[cycle-rollover] project failed", candidate.projectId, error);
    }
  }
  const broadcasts = await Promise.allSettled(
    [...touchedProjects].map((projectId) => broadcastBoardChange(projectId)),
  );
  for (const broadcast of broadcasts) {
    if (broadcast.status === "rejected") {
      console.error("[cycle-rollover] realtime broadcast failed", broadcast.reason);
    }
  }
  return moved;
};
