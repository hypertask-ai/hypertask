import { HTPR_7975_COLUMN_WORK_LIMITS_FLAG } from "@/lib/flags/definitions/htpr-7975-column-work-limits";
import { isFeatureEnabled } from "@/lib/flags";
import prisma from "@/lib/prisma";
import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";
import { boardHygieneReport } from "@/lib/boardHygiene";
import { columnRoleFor } from "@/lib/mcp/boards/columnRole";
import { getProjectWhere } from "./getAllIncludes";

export async function getBoardHygiene(projectId: number, userId: number, agentId?: string | null, teamScope?: AgentTokenTeamScope | null) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, status: "Normal", ...getProjectWhere(userId, agentId, teamScope) },
    select: {
      id: true,
      section: { where: { deleted: false }, orderBy: { ranking: "asc" }, select: { id: true, section_title: true, isDone: true, wipLimit: true } },
      labels: { select: { id: true, value: true, createdAt: true, _count: { select: { task: { where: { task: { status: "Normal" } } } } } } },
      project_view: { select: { allViews: { where: { visibility: "Public" }, select: { board_filters: true } } } },
    },
  });
  if (!project) return null;
  const workLimits = await isFeatureEnabled(HTPR_7975_COLUMN_WORK_LIMITS_FLAG, userId);
  const openSectionIds = project.section.filter(section => columnRoleFor(section) !== "done").map(section => section.id);
  const [untaggedOpenTickets, openCounts, staleCounts] = await Promise.all([prisma.task.count({
    where: { projectId, status: "Normal", OR: [{ sectionId: { in: openSectionIds } }, { sectionId: null }], taskLabels: { none: {} } },
  }), prisma.task.groupBy({
    by: ["sectionId"],
    where: { projectId, status: "Normal", sectionId: { in: openSectionIds } },
    _count: { _all: true },
  }), prisma.task.groupBy({
    by: ["sectionId"],
    where: { projectId, status: "Normal", sectionId: { in: openSectionIds }, updatedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
    _count: { _all: true },
  })]);
  return boardHygieneReport({
    untaggedOpenTickets,
    columns: project.section.filter(section => openSectionIds.includes(section.id)).map(section => ({
      id: section.id, title: section.section_title,
      openTickets: openCounts.find(count => count.sectionId === section.id)?._count._all ?? 0,
      staleTickets: staleCounts.find(count => count.sectionId === section.id)?._count._all ?? 0,
      wipLimit: workLimits ? section.wipLimit ?? null : null,
    })),
    labels: project.labels.map(label => ({ ...label, taskCount: label._count.task })),
    publicViewFilters: project.project_view?.allViews.map(view => view.board_filters) ?? [],
  });
}
