import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
// import getAllUsers from "@/utils/controllers/users/getAll";


import prisma from "@/lib/prisma";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { getUserAnnouncements } from "@/utils/controllers/users/getAnnouncements";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "GET" && req.method !== "POST") {
        return res.status(405).json({ message: "Method not allowed" });
    }

    const session = verifySession(req.cookies[SESSION_COOKIE])
    if (!session) {
        return res.status(401).json({ error: "Unauthorized", code: "SESSION_REQUIRED" })
    }

    if (req.method === "GET") {
        try {
            const announcements = await getUserAnnouncements(session.id)
            if (!announcements) return res.status(404).json(null)
            return res.status(200).json(announcements)
        } catch (error) {
            console.log(error);
            return res.status(500).json(null)
        }
    } 
    else if(req.method==="POST"){
        const {announcementIds} = req.body
        if (!announcementIds) return res.status(104).json({message:"Bad request. missing info"})
        const currentDate = new Date();

        const user_announcements = await prisma.userAnnouncement.updateMany({
            where:{
                userId:session.id,
                announcementId:{in:announcementIds}
            },
            data:{
                readAt:currentDate
            }
        })
        return res.status(200).json(user_announcements)
    }
    
};

export default handler;
