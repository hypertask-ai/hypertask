import { z } from "zod";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import { viewWriteJson } from "./response";
import prisma from "@/lib/prisma";
import getProjectView from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";




// ============= simple stuff here
// 1. user selects the default view.
// 2. so that means the applied view in user_project_view is now null.
// 3. LITERALLY THATS IT

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    const userId = session.userId;

    // lets check if the api request misses info like user, projectid.

    const { projectId,  newViewId } = req.body

    try {
        if (!projectId || !newViewId) return viewWriteJson({ message: "Missing required information" }, 101)
        const view = await prisma.view.findUnique({
            where: { id: newViewId },
            select: {
                project_view: {
                    select: { id: true, projectId: true, default_view_id: true }
                }
            }
        })
        if (!view) throw new Error("View does not exist")
        const project_View = view.project_view
        const viewProjectId = project_View.projectId
        console.log("🚀 ~ consthandler:NextApiHandler= ~ project_View:", project_View)

        const updatedUserProjectView = await prisma.user_Project_View.upsert({
            create: {
                // ... data to create a User_Project_View
                userId:userId,
                project_view_id:project_View.id,
                appliedViewId:newViewId,

              },
              update: {
                // ... if the newviewId is the default board, then simply set appliedView and unsaved as null
                appliedViewId:project_View.default_view_id===newViewId?null:newViewId,
              },
              where: {
                // ... the filter for the User_Project_View we want to update
                user_project:{
                    userId:userId,
                    project_view_id:project_View.id
                }
              }
        })
        const currentDate=new Date()

        await prisma.view.update({
            where:{
                id: newViewId
            },
            data:{
                lastUsedAt:currentDate
            }
        })


        const lastviewused = await prisma.view_Last_Used.upsert({
            create:{
                userId:userId,
                viewId:newViewId,
                lastUsedAt:currentDate
            },
            update:{
                lastUsedAt:currentDate
            },
            where:{
                user_view_last_used:{
                    userId:userId,
                    viewId:newViewId,
                }
            }
        })

        if (updatedUserProjectView.unsavedViewId) await prisma.view.delete({
            where:{
                id:updatedUserProjectView.unsavedViewId
            }
        })
        console.log("🚀 ~ consthandler:NextApiHandler= ~ updatedUserProjectView:", updatedUserProjectView)
        const project_view_updated = await getProjectView(viewProjectId, userId)
        console.log("🚀 ~ consthandler:NextApiHandler= ~ project_view_updated:", project_view_updated)

        return viewWriteJson(project_view_updated, 200)
    } catch (error) {
        console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error)
        return viewWriteJson(error, 500)
    }

  },
});

export const POST = route;
