import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { teamBillingSnapshotSelect } from "@/lib/ai/teamBillingSnapshotSelect";
import { sanitizeProjectBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";

const minimalViewSelect = {
  userId: true,
  visibility: true,
  project_view_id: true,
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
    ownerId: true,
    members: {
      where: { userId },
      select: {
        userId: true,
        role: true,
        status: true,
        agentId: true,
      },
    },
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
  ...getProjectWhere(userId),
});

const getAllMinimal = async (
  userId: number,
  mode?: "ExtraMinimal" | "Calendar",
  includeCalendarLabels = true,
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
          labels: includeCalendarLabels,
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
      json: projects.map((project) => {
        const safeProject = sanitizeProjectBoardFilters(project, userId);
        if (mode === "ExtraMinimal" && "project_view" in safeProject && safeProject.project_view) {
          type MinimalView = Prisma.ViewGetPayload<{ select: typeof minimalViewSelect }>;
          const pv = safeProject.project_view as {
            default_view: MinimalView | null;
            user_project_views: Array<{ appliedView: MinimalView | null; unsavedView: MinimalView | null }>;
          };
          for (const view of [pv.default_view, ...pv.user_project_views.flatMap(row => [row.appliedView, row.unsavedView])]) {
            if (!view) continue;
            delete (view as Partial<typeof view>).userId;
            delete (view as Partial<typeof view>).visibility;
            delete (view as Partial<typeof view>).project_view_id;
          }
        }
        return safeProject;
      }),
    };
  } catch (error) {
    console.log("🚀 ~ getAllMinimal ~ error:", error);
    return { status: 400, json: [] };
  }
};

export default getAllMinimal;
