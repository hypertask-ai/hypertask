import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import getAllMinimal from "@/utils/controllers/projects/getAllMinimal";
import { getSessionUser } from "@/lib/auth/getSessionUser";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        const session = await getSessionUser(
          new Headers(req.headers as Record<string, string>)
        );
        if (!session) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        const userId = session.userId;
        const response = await getAllMinimal(userId)
        return res.status(response.status).json(response.json)
       
    } else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;