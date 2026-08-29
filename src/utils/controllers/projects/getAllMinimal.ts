import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { teamBillingSnapshotSelect } from "@/lib/ai/teamBillingSnapshotSelect";
import { sanitizeProjectBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";

/**
 * ExtraMinimal consumers (grep: useGetAllProjectsMinimal / ExtraMinimal):
 * - Search: project.id, project.title
 * - Move task modal: project.id, project.title, column list via returnActiveOrDefaultColumnSections
 * - Create task modal: board filters plus the destination team's AI entitlement
 *   and model default when the user switches boards before creating the task
 *
 * NOT needed here: allViews, full View rows, tasks, members, full team data,
 * custom AI instructions beyond the selected model
 */
const minimalViewSelect = {
  board_columns_view: true,
  board_filters: true,
  board_staleness: true,
  board_show_archived: true,
  board_layout: true,
  slug: true,
} satisfies Prisma.ViewSelect;

export function extraMinimalProjectInclude(
  userId: number
): Prisma.ProjectSelect {
  return {
    id: true,
    title: true,
    name: true,
    teamId: true,
    team: {
      select: teamBillingSnapshotSelect,
    },
    ai_custom_instructions: {
      select: {
        model_selected: true,
      },
    },
    uniqueIdentifier: true,
    timeTrackingEnabled: true,
    showTimeTotals: true,
    stalenessEnabled: true,
    staleWarnDays: true,
    staleHotDays: true,
    staleNudgeEnabled: true,
    autoArchiveAfterDays: true,
    project_view: {
      include: {
        default_view: { select: minimalViewSelect },
        user_project_views: {
          where: { userId },
          select: {
            appliedView: { select: minimalViewSelect },
            unsavedView: { select: minimalViewSelect },
          },
        },
      },
    },
    section: {
      where: { deleted: false },
      orderBy: { ranking: "asc" },
      select: {
        id: true,
        section_title: true,
        visibility: true,
        isDone: true,
        autoAssignUserId: true,
        autoAssignAgentId: true,
      },
    },
  };
}

export const extraMinimalProjectWhere = (
  userId: number
): Prisma.ProjectWhereInput => ({
  status: "Normal",
  teamId: { not: null },
  googleAccount: { isNot: null },
  OR: [
    { ownerId: parseInt(userId.toString(), 10) },
    { members: { some: { userId } } },
  ],
});

const getAllMinimal = async (
  userId: number,
  mode?: "ExtraMinimal" | "Calendar"
) => {
  try {
    if (!userId) {
      return { status: 400, json: [] };
    }

    let projects;

    if (mode === "ExtraMinimal") {
      projects = await prisma.project.findMany({
        where: extraMinimalProjectWhere(userId),
        orderBy: { id: "asc" },
        select: extraMinimalProjectInclude(userId),
      });
    } else if (mode === "Calendar") {
      projects = await prisma.project.findMany({
        where: extraMinimalProjectWhere(userId),
        orderBy: { id: "asc" },
        select: {
          id: true,
          name: true,
          title: true,
          owner: true,
          members: { include: { user: true } },
          labels: true,
          _count: {
            select: {
              tasks: {
                where: {
                  status: "Normal",
                  deletedAt: null,
                  updatedAt: { not: null },
                  dueDate: { not: null },
                },
              },
            },
          },
        },
      });
    } else {
      projects = await prisma.project.findMany({
        where: extraMinimalProjectWhere(userId),
        orderBy: { id: "asc" },
        include: {
          section: {
            select: {
              section_title: true,
              id: true,
              visibility: true,
              isDone: true,
              autoAssignUserId: true,
              autoAssignAgentId: true,
            },
            where: { deleted: false },
            orderBy: { ranking: "asc" },
          },
          ai_custom_instructions: true,
        },
      });
    }

    return {
      status: 200,
      json: projects.map((project) => sanitizeProjectBoardFilters(project)),
    };
  } catch (error) {
    console.log("🚀 ~ getAllMinimal ~ error:", error);
    return { status: 400, json: [] };
  }
};

export default getAllMinimal;
