import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import sections from "@/utils/controllers/projects/sections";

import prisma from "@/lib/prisma";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "PUT") {
        try {
            // console.log(req.body);
            const { section, projectId } = req.body;
            const response = await sections(section, projectId)
            return res.status(response.status).json(response.json);

            // const project = await prisma.project.update({
            //     where: {
            //         id: projectId
            //     },
            //     data: {
            //         sections: section
            //     }
            // })
            // res.status(200).json(project);
        } catch (error) {
            console.log(error);

            res.status(500).json({ message: "Internal server error" });
        }
    }
    else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;