
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

function finiteInteger(value: unknown): number | null {
    if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
    if (typeof value === "string" && /^-?\d+$/.test(value)) {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) ? parsed : null;
    }
    return null;
}

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "POST" && req.method !== "PUT") {
        return res.status(405).json({ message: "Method not allowed" });
    }
    const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
    if (!session) return res.status(401).json({ message: "Unauthorized" });
    const projectId = finiteInteger(req.body?.projectId);
    const index = finiteInteger(req.body?.index);
    if (projectId === null || projectId === 0 || index === null) {
        return res.status(400).json({message:"Missing Required information"})
    }
    const setting = await prisma.userSetting.findUnique({
        where: { userId: session.userId },
        select: { id: true },
    })
    if (!setting) return res.status(404).json({ message: "Not found" })
    const userSettingId = setting.id;
    if (projectId !== -1) {
        const project = await prisma.project.findFirst({
            where: { id: projectId, ...getProjectWhere(session.userId) },
            select: { id: true },
        })
        if (!project) return res.status(403).json({ message: "Forbidden" })
    }
    if (req.method === "POST") {
        try {
            const deleted = await prisma.favorites.deleteMany({
                where:{
                    userSettingId:userSettingId,
                    projectId:projectId                     
                }
            })
            console.log("🚀 ~ file: addEditFavorites.ts:27 ~ consthandler:NextApiHandler= ~ deleted:", deleted)
            
            const newFavorite = await prisma.favorites.create({
                data:{
                    projectId:projectId,
                    userSettingId:userSettingId,
                    index:index
                }
            })
            return res.status(200).json(newFavorite)
        } catch (error) {
            console.log(error);
            return res.status(500).json({ message: JSON.stringify(error) });
        }
    }

    else if (req.method === "PUT") {
        try {
            if (projectId ===-1){
                const deletedFavorite = await prisma.favorites.deleteMany({
                    where:{
                        userSettingId:userSettingId,
                        index:index
                    }
                })
                return res.status(200).json(deletedFavorite)
            }
            
            const deletedFavorites = await prisma.favorites.deleteMany({
                where:{
                    projectId:projectId,
                    userSettingId:userSettingId,
                  
                }
            })
            console.log("🚀 ~ file: addEditFavorites.ts:53 ~ consthandler:NextApiHandler= ~ deletedFavorites:", deletedFavorites)

            const updatedFavorite = await prisma.favorites.updateMany({
                where:{
                    userSettingId:userSettingId,
                    index:index 
                },
                data:{
                    projectId:projectId,
                    userSettingId:userSettingId,
                    index:index
                }
            })
            return res.status(200).json(updatedFavorite)

        } catch (error) {
            console.log(error);
            return res.status(400).json({ message: JSON.stringify(error) });
        }
    } 
    
    else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;