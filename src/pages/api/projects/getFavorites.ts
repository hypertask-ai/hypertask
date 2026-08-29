import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import getAllMinimal from "@/utils/controllers/projects/getAllMinimal";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        const user = req.cookies.nookies_user
        if(!user){
            return res.status(400).json({message:"User isn't logged in"})
        }
        const _parsedUser = JSON.parse(user)
        const response = await getAllMinimal(_parsedUser.id)
        return res.status(response.status).json(response.json)
       
    } else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;