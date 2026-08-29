// route = "/api/projects/views/sync-view"
import prisma from "@/lib/prisma";
import { sanitizeViewBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";




// ============= simple stuff here
// 1. user selects the default view.
// 2. so that means the applied view in user_project_view is now null.
// 3. LITERALLY THATS IT
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        // lets check if the api request misses info like user, projectid.

        const { projectId, board_columns_view } = req.body

        const currentUser = JSON.parse(req.cookies.nookies_user??"{}")
        try {
            if (!projectId || !currentUser) return res.status(101).json({ message: "Missing required information" })
            const project_View = await prisma.project_View.upsert({where:{projectId},create:{projectId},update:{}})
            const user_project_view = await prisma.user_Project_View.findUnique({
                where: {
                    user_project:{
                        userId:currentUser.id,
                        project_view_id:project_View.id
                    }
                },
                include:{
                    appliedView:true,
                    project_view:{
                        include:{
                            default_view:true
                        }
                    }
                }
            })
            var updatedView;
            // ========== if there's an applied view, update its payload
            if (user_project_view?.appliedViewId){
                updatedView = await prisma.view.update({
                    where:{
                        id:user_project_view.appliedViewId
                    },
                    data:{
                        board_columns_view,
                    }
                })

            }

            // ========== if there's a default view, update its payload
            if (user_project_view?.project_view.default_view_id){
                updatedView =await prisma.view.update({
                    where:{
                        id:user_project_view.project_view.default_view_id
                    },
                    data:{
                        board_columns_view,
                    }
                })
            }
            return res.status(200).json(sanitizeViewBoardFilters(updatedView))
        } catch (error) {
            console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error)
            return res.status(500).json(error)
        }
    }
};


export default handler
