import prisma from "@/lib/prisma";
import { ISection } from "@/models/model";
import { getViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";

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

    let defaultSections = project?.project_view?.default_view
      ?.board_columns_view as unknown as ISection[];
    const activeView = getViewFromProject(project);

    if (activeView?.type !== "Default") {
      const activeSections = activeView?.view.board_columns_view as ISection[];
      const newSectionsToReturn = defaultSections.map((section) => {
        const sectionFoundInActive = activeSections.find(
          (aSection) => aSection.id === section.id
        );
        if (sectionFoundInActive === undefined) {
          return { ...section, visibility: false };
        } else if (sectionFoundInActive) {
          return { ...section, visibility: sectionFoundInActive.visibility };
        }
        return section;
      });
      defaultSections = newSectionsToReturn;
    }

    // const sections = await prisma.section.findMany({
    //     where:{
    //         projectId:projectId,
    //         deleted:false,
    //     },
    //     orderBy:{
    //       ranking:"asc"
    //     }

    // });
    return {
      status: 200,
      json: defaultSections,
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      status: 200,
      json: { error: error },
    };
  }
};

// Run the main function
export default sectionGetProjectSections;
