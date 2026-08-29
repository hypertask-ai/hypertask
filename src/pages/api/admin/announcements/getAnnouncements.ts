import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { requireAnnouncementSecret } from "@/lib/admin/requireAnnouncementSecret";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    try {
        if (!requireAnnouncementSecret(req, res)) return;
        if (req.method==="GET"){
            const announcements = await prisma.announcments.findMany({orderBy:{createdAt:"desc"}})
            return res.status(200).json(announcements)
        }
    } catch (error) {
        console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error)
        return res.status(500).json({error})
    }
   
}


export default handler;
