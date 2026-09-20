// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import { getSequentialLetters } from '@/utils/helperFunctions/helperFunctions';
import { updateTaskSingle } from '@/utils/controllers/tasks/single';

export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    // ============== first find all the teams
    const teams = await prisma.team.findMany({include:{projects:{include:{tasks:true}}}})
    const currentUser = JSON.parse(req.cookies.nookies_user!)


    // ============== go through each team and its boards
    for (const team of teams){
        for (const project of team.projects){
            console.log("🚀 ~ project:", project)
            var updated=false;
            var tries =3

            const randomLetters = getSequentialLetters(project.title??project.name);
            console.log("🚀 ~ randomLetters:", randomLetters)

            do {
                // now check if INSIDE THAT TEAM there are any projects with similar 4 letters. 
                const check = team.projects.find(project=>project.uniqueIdentifier===randomLetters)
                console.log("🚀 ~ check:", check)
                if (!check){
                    console.log("=============== updating board ==============")

                    await prisma.project.update({
                        where:{id:project.id}
                        ,
                        data:{
                            uniqueIdentifier:randomLetters
                        }
                    })

                    console.log("=============== updating tasks ==============")
                    // =================== RUNNING LOOP FOR EACH TASK
                    for (const task of project.tasks){
                        // console.log("🚀 ~ task:", task)
                        await updateTaskSingle({id: task.id, ticketNumber: randomLetters+"-"+task.uniqueIndex}, currentUser)
                        
                    }


                    updated=true
                }
                tries-=1
            } while (!updated && tries > 0); // Adjusted condition here
        }
    }
    return res.status(200).json({ name: 'John Doe' })
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
