import { logDesktopCliResponse } from "@/lib/auth/desktopCliTokenUser";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getUserAnnouncements } from "@/utils/controllers/users/getAnnouncements";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "GET" && req.method !== "POST") {
        return res.status(405).json({ message: "Method not allowed" });
    }

    const session = await getSessionUser(new Headers(req.headers as Record<string, string>))
        logDesktopCliResponse(session, req, res)
    if (!session) {
        return res.status(401).json({ error: "Unauthorized", code: "SESSION_REQUIRED" })
    }

    if (req.method === "GET") {
        try {
            const announcements = await getUserAnnouncements(session.userId)
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
                userId:session.userId,
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
