import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
// import getAllUsers from "@/utils/controllers/users/getAll";


import prisma from "@/lib/prisma";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";


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
            const user = await prisma.user.findUnique({
                where: {
                    id:session.id
                }
            })

            if (!user) throw "No such user"

            // UserAnnouncement rows are only materialized when an announcement
            // is sent, so anyone created afterwards (guests, fresh signups) had
            // an empty Latest Updates panel. Backfill the recent ones on read;
            // readAt stays null so they show as new.
            const missing = await prisma.announcments.findMany({
                where: {
                    isActive: true,
                    userAnnouncements: { none: { userId: user.id } },
                },
                orderBy: { createdAt: "desc" },
                take: 15,
                select: { id: true },
            })
            if (missing.length) {
                await prisma.userAnnouncement.createMany({
                    data: missing.map((announcement) => ({
                        userId: user.id,
                        announcementId: announcement.id,
                    })),
                    skipDuplicates: true,
                })
            }

            const user_announcements = await prisma.userAnnouncement.findMany({
                where:{
                    userId:user.id
                },
                include:{
                    announcement:true,
                },

                orderBy:{
                    createdAt:"desc"
                },
                take:15,
                
            })
            // console.log("🚀 ~ consthandler:NextApiHandler= ~ user_announcements:", user_announcements)
            
            return res.status(200).json(user_announcements)
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
