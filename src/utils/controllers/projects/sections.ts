import { logger as htLogger } from "#logger";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";


const sections = async (section:any, projectId:number ) => {
        try {
            // debug.log(req.body);
            const project = await prisma.project.update({
                where: {
                    id: projectId
                },
                data: {
                    sections: section
                }
            })
            return({
                status:200,
                json:project
            })
            // res.status(200).json(project);
        } catch (error) {
            htLogger.info(error);
            return({
                status:500,
                json:{ message: "Internal server error" }
            })
        }

};

export default sections;