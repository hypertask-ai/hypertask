import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import getAllUsers from "@/utils/controllers/users/getAll";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const getAll = await getAllUsers()
            return res.status(getAll.status).json(getAll.res);
        } catch (error) {
            console.log(error);
            return res.status(200).json([]);
        }
    } else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;