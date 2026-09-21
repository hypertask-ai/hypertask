// route = "/api/projects/views/switch-view"
import prisma from "@/lib/prisma";
import getProjectView from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";




// ============= simple stuff here
// 1. user selects the default view.
// 2. so that means the applied view in user_project_view is now null.
// 3. LITERALLY THATS IT
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        // lets check if the api request misses info like user, projectid.

        const { projectId,  newViewId } = req.body

        const currentUser = JSON.parse(req.cookies.nookies_user??"{}")
        try {
            if (!projectId || !currentUser || !newViewId) return res.status(101).json({ message: "Missing required information" })
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
                    userId:currentUser.id,
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
                        userId:currentUser.id,
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
                    userId:currentUser.id,
                    viewId:newViewId,
                    lastUsedAt:currentDate
                },
                update:{
                    lastUsedAt:currentDate
                },
                where:{
                    user_view_last_used:{
                        userId:currentUser.id,
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
            const project_view_updated = await getProjectView(viewProjectId, currentUser.id)
            console.log("🚀 ~ consthandler:NextApiHandler= ~ project_view_updated:", project_view_updated)
            
            return res.status(200).json(project_view_updated)
        } catch (error) {
            console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error)
            return res.status(500).json(error)
        }
    }
};


export default handler
