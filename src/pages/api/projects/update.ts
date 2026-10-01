import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import updateProject from "@/utils/controllers/projects/update";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import type { IUser } from "@/models/model";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        const session = await getSessionUser(
          new Headers(req.headers as Record<string, string>)
        );
        if (!session) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        const currentUser = await loadSessionUserRecord(session.userId);
        try {
            const { projectId, title,sorting_mode,uniqueIdentifier } = req.body;

            

            const response  = await updateProject(projectId, title,sorting_mode,uniqueIdentifier, currentUser )
            return res.status(response.status).json(response.json)
            // if (!projectId || !title) {
            //     return res.status(400).json({ message: "Required information missing" });
            // }
            // const project = await prisma.project.update({
            //     where: {
            //         id: projectId
            //     },
            //     data: {title

            //     }
            // })
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