import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";
import { CompleteOnboardingFirstStep } from "@/utils/controllers/users/completeOnboardingStep";
import { IUser } from "@/models/model";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  if(req.method==="POST"){
      try {
        const {userId, teamTitle, boardTitle = "MyBoard", companySize, companyRole} = req.body
        if (!userId || !teamTitle) return res.status(400).json({message:"Bad request. missing info"})
        const user = await prisma.user.findUnique({
            where:{
                id:userId
            },
            include:{
                UserSetting:{
                    include:{
                        user:true,
                        favorites:true
                    }
                }
            }

        })
        if (!user) return res.status(404).json({message:"User doesn't exist"})


        const response = await CompleteOnboardingFirstStep(
          user as unknown as IUser,
          teamTitle,
          boardTitle,
          companySize,
          companyRole,
          { createInitialBoard: false }
        )
        if (!response) return res.status(500).json({message:"Onboarding step failed"})
        return res.status(200).json({response})
      } catch (error) {
        console.error("completeOnboardingStep1 error:", error)
        return res.status(500).json({message: error instanceof Error ? error.message : String(error)})
      }
    }
    
    else {
        return res.status(405).json({ message: "Method not allowed" });
    }
    
};

export default handler;
