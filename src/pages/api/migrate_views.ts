// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  
  // lets create a fuckin view shall we. and now lets lets lets add a view
  try {

    const {projectId, userId, mode} = req.body
    console.log("🚀 ~ req.body:", req.body)
    
    // Lets create a project view
    const projectView = await prisma.project_View.upsert({
      create: {
        // ... data to create a Project_View
        projectId:projectId,
      },
      update: {
        // ... in case it already exists, update
        default_view_id:"ecbcfd2b-49a2-49a1-a032-1dd77795960b"
      },
      where: {
        projectId:projectId,
        
      },
      })
    console.log("🚀 ~ projectView:", projectView)

    // // lets create a view against our project_view
    // const createdView = await prisma.view.create({
    //   data:{
    //     userId,
    //     project_view_id:projectView.id,
    //     board_sorting_mode:mode,
    //     title:"First one and sorted by prio",
    //   }
    // })
    // console.log("🚀 ~ createdView:", createdView)
    // const user_project_view = await prisma.user_Project_View.create({
    //   data:{
    //     appliedViewId:createdView.id,
    //     project_view_id:projectView.id,
    //     userId,
    //   }
    // })
    
    // lets update the project_view and add a default against it
    

    // lets have it added against the user, and say which project it belongs to
  // now lets 
    // const user_project_view = await prisma.user_Project_View.update({
    //   data:{
    //     appliedViewId:createdView.id,
    //     project_view_id:projectView.id
    //   },
    //   where:{
    //     userId
    //   }
    // })
    // console.log("🚀 ~ user_project_view:", user_project_view)

    // now lets upsert it against the user_project_view, AND WHY, you must ask whyyyyy???
    // well, when a project is fetched, you get a default project_view, but then you get the APPLIED view
    // against that user

    return res.status(200).json({})
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
