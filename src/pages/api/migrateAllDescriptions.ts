// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";


type Data = {
  count: number
}

export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  // find all tasks first
  const tasks = await prisma.task.findMany({
    include:{description_:true},
  })
  // loop through each task
  var count = 0 ;
  for (const task of tasks) {
    // console.log("🚀 ~ file: migrateAllDescriptions.ts:20 ~ task:", task)
    // check if this task has the description or not 
    if (!task.description_){
      console.log("=========> count: "+count)
      // if task doesn't have description, then create a description object
      const taskDescription = await prisma.description.create({
        data:{
          content:task.description,
          creatorId:task.userId,
          taskId:task.id
        }
      })
      console.log("🚀 ~ file: migrateAllDescriptions.ts:31 ~ taskDescription:", taskDescription)
      count +=1
    }

  }

 
  res.status(200).json({ count: count })
}
