import getFirst from "@/utils/controllers/projects/getFirst";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const user = JSON.parse(req.cookies.nookies_user!)
            if (!user) return res.status(401).json({message:"Missing user"})
            const response  = await getFirst(user.id)
            return res.status(response.status).json(response.json)

        } catch (error) {
            console.log(error);
            return res.status(400).json({ message: JSON.stringify(error) });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;