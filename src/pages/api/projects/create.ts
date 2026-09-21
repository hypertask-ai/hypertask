import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import create from "@/utils/controllers/projects/create";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        try {
            const { userId, title, teamId, googleAccountId } = req.body;
            const response = await create(userId, title, teamId, googleAccountId )
            return res.status(response.status).json(response.json)
       
        } catch (error) {
            htLogger.info(error);
            return res.status(400).json({ message: JSON.stringify(error) });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default withAuth(handler);