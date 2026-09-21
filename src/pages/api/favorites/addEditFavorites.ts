
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    const {userSettingId, index, projectId} = req.body;
    // if any is missing, just return 
    if (!userSettingId  || !projectId){
        return res.status(400).json({message:"Missing Required information"})
    }
    // =================== adding a favorite
    if (req.method === "POST") {
        try {
            // just for safety, delete if there is any existing with same params
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

    // =================== updating a favorite
    else if (req.method === "PUT") {
        try {


            // ============= user clicks DO NOTHING, so only userSettingId and index is given 
            if (projectId ===-1){
                const deletedFavorite = await prisma.favorites.deleteMany({
                    where:{
                        userSettingId:userSettingId,
                        index:index
                    }
                })
                return res.status(200).json(deletedFavorite)
            }
            
            // ========== delete wherever that projectId was before
            const deletedFavorites = await prisma.favorites.deleteMany({
                where:{
                    projectId:projectId,
                    userSettingId:userSettingId,
                  
                }
            })
            console.log("🚀 ~ file: addEditFavorites.ts:53 ~ consthandler:NextApiHandler= ~ deletedFavorites:", deletedFavorites)

            // =============== update favorite. 
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