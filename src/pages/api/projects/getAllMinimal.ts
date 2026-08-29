import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import getAllMinimal from "@/utils/controllers/projects/getAllMinimal";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        const user = req.cookies.nookies_user
        const {mode} = req.query
        if(!user){
            return res.status(400).json({message:"User isn't logged in"})
        }
        let _parsedUser;
        try {
            _parsedUser = JSON.parse(user);
        } catch (e) {
            return res.status(400).json({ message: "Invalid user cookie" });
        }
        if (!_parsedUser || !_parsedUser.id) {
            return res.status(400).json({ message: "User data is invalid or missing id" });
        }
        const response = await getAllMinimal(_parsedUser.id, mode as string as "ExtraMinimal")
        return res.status(response.status).json(response.json)
       
    } else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;