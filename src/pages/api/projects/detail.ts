import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import projectDetail from "@/utils/controllers/projects/detail";

import { loadCurrentUser } from "@/lib/auth/currentUser";
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from "@/lib/flags";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        try {
            if (req.query?.compat === "htpr-6924") {
                let retired = false;
                try {
                    const currentUser = await loadCurrentUser(
                        new Headers(req.headers as Record<string, string>)
                    );
                    if (currentUser) {
                        retired = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, currentUser.userId);
                    }
                } catch {
                    // A failed identity/flag probe must preserve the legacy response.
                }
                if (retired) {
                    return res.status(410).json({
                        error: "Legacy project detail has been retired",
                        replacement: "/api/projects/boardTasks"
                    });
                }
            }
            const { projectId } = req.body;
            const response = await projectDetail(projectId)
            return res.status(response.status).json(response.json)
            // if (!projectId) {
            //     return res.status(400).json({ message: "Project id is required" });
            // }
            // let project = await prisma.project.findFirst({
            //     where: {
            //         id: projectId
            //     },
            //     include: {
            //         tasks: {
            //             include: {
            //                 assignees: {
            //                     include: {
            //                         user: true
            //                     }
            //                 },
            //                 comments:true,

            //             },
            //             where: {
            //                 status: 'Normal'
            //             },
            //         },
            //         section:{
            //             where:{
            //                 deleted:false,
            //                 visibility:true
            //             },
            //             orderBy:{
            //                 ranking:"asc"
            //             }
            //         },
            //         owner: true
            //     }
            // })
            
            // if (!project) {
            //     return res.status(400).json({ message: "Project not found" });
            // }
            // res.status(200).json(project);
        } catch (error) {
            console.log(error);
            return res.status(400).json({ message: JSON.stringify(error) });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;