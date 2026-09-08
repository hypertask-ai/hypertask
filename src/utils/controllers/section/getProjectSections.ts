import prisma from "@/lib/prisma";
import { ISection } from "@/models/model";
import { getViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { resolveMoveToColumnSections } from "./moveToColumnSections";

const sectionGetProjectSections = async (
  projectId: number,
  currentUserId: number
) => {
  try {
    //We are now fetching sections w.r.t the default sections. By comparing active view sections with default, we return
    //sections for move column modal.
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
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

    const defaultColumns =
      project?.project_view?.default_view?.board_columns_view;
    const activeView = getViewFromProject(project);

    // Only paid for when the stored default view cannot answer: a board with no
    // project_view, no default view, or an empty column list.
    const boardSections =
      Array.isArray(defaultColumns) && defaultColumns.length
        ? []
        : ((await prisma.section.findMany({
            where: { projectId, deleted: false },
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
    // A 200 here made a server-side crash indistinguishable from "this board
    // has no columns": the client coerces a non-array body to [] and the move
    // dialog rendered empty with nothing in the console (HTPR-6259).
    return {
      status: 500,
      json: { error: error instanceof Error ? error.message : String(error) },
    };
  }
};

// Run the main function
export default sectionGetProjectSections;
