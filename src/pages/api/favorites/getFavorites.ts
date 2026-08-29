
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { publicAgentSelect } from "@/lib/agents/publicAgent";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const {userSettingId} = req.query;
            
            if (!userSettingId) return res.status(400).json({message:"Missing Required Information"})

            const favoritesAll = await prisma.favorites.findMany({
                where:{
                    userSettingId:userSettingId as string
                },
                include:{
                    project:{
                        include:{
                            owner:true,
                            members:{
                                include:{
                                    user:true,
                                    // Needed so the sidebar can tell agent members
                                    // apart from humans (agents share the owner's
                                    // user, so without this they render as the
                                    // owner's face repeated). See TitleAndMembers.
                                    agent: { select: publicAgentSelect }
                                }
                            },
                            
                        }
                    },
                    
                },
                orderBy:{
                    index:"asc"
                }
            })
              
            return res.status(200).json(favoritesAll)
           
        } catch (error) {
            console.log(error);
            return res.status(400).json({ message: JSON.stringify(error) });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;
