import { savedViewBoardAccessWhere } from "../projects/getAllIncludes";
import { sanitizeProjectBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import prisma from "@/lib/prisma";
import { ISection } from "@/models/model";
import { getViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { resolveMoveToColumnSections } from "./moveToColumnSections";

const sectionGetProjectSections = async (
  projectId: number,
  currentUserId: number
) => {
  try {
    const loadedProject = await prisma.project.findFirst({
      where: {
        id: projectId,
        ...savedViewBoardAccessWhere(currentUserId),
      },
      include: {
        project_view: {
          include: {
            user_project_views: {
              where: {
                userId: currentUserId,
              },
              select: {
                appliedView: true,
                unsavedView: true,
                userId: true,
                appliedViewId: true,
                unsavedViewId: true,
                project_view_id: true,
              },
            },
            default_view: true,
          },
        },
      },
    });

    if (!loadedProject) return { status: 404, json: { message: "Project not found" } };
    const project = sanitizeProjectBoardFilters(loadedProject, currentUserId);
    const defaultColumns =
      project?.project_view?.default_view?.board_columns_view;
    const activeView = getViewFromProject(project);

    const boardSections =
      Array.isArray(defaultColumns) && defaultColumns.length
        ? []
        : ((await prisma.section.findMany({
            where: { projectId: project.id, deleted: false },
            orderBy: { ranking: "asc" },
          })) as unknown as ISection[]);

    return {
      status: 200,
      json: resolveMoveToColumnSections({
        defaultColumns,
        activeColumns: activeView?.view?.board_columns_view,
        activeViewType: activeView?.type,
        boardSections,
      }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      status: 500,
      json: { error: error instanceof Error ? error.message : String(error) },
    };
  }
};

export default sectionGetProjectSections;
