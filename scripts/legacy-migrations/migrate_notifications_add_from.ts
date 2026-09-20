// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    
    const allNotifications  = await prisma.notification.findMany({
        include:{
            assignee:{
                include:{
                    assigner:true
                }},
            comment:{
                include:{
                    creator:true
                }
            },
            reaction:{
                include:{
                    user:true
                }
            }
        }
    })

    // run a loop through each one.
    for (const notification of allNotifications){
        // check what its type is
        
        console.log("------ updating "+ notification.id + " ---------")
        let fromUserId = notification.type==="Reacted"?
                            notification.reaction?.user?.id
                        :
                        notification.type==="Assigned"?
                            notification.assignee?.assigner?.id
                        :
                            notification.comment?.creator?.id
    
        if (fromUserId){
            console.log("🚀 ~ fromUserId:", fromUserId)
            const updatedNotification = await prisma.notification.update({
                where:{
                    id:notification.id
                },
                data:{
                    fromUserId:fromUserId
                }
            })
            console.log("🚀 ~ updatedNotification:", updatedNotification)
        }
        console.log('------------------- LOOK TO NEXT IF ANY --------------------')
    }

    console.log('------------------- END --------------------')

    return res.status(200)

  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
