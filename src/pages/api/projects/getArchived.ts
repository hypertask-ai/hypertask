import getArchived from "@/utils/controllers/projects/getArchived";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        const user = req.cookies.nookies_user
        if(!user){
            return res.status(400).json({message:"User isn't logged in"})
        }
        const _parsedUser = JSON.parse(user)
        const response = await getArchived(_parsedUser.id)
        return res.status(response.status).json(response.json)
       
    } else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;