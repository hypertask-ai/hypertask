import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import projectDetail from "@/utils/controllers/projects/detail";

import prisma from "@/lib/prisma";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        try {
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