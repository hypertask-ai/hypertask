// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    
    const timeNow = new Date(2024, 3, 28); // Note: Month is 3 for April
    // first all inbox elements

    await prisma.notification.updateMany({
        where:{archivedAt:null},
        data:{
            archivedAt:timeNow
        }
    })
    await prisma.task.updateMany({  
        where:{archivedAt:null},
        data:{
            archivedAt:timeNow
        }})
        return res.status(200)

  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
