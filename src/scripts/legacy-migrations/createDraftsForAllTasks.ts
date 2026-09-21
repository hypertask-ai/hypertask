// // Next.js API route support: https://nextjs.org/docs/api-routes/introduction

// import type { NextApiRequest, NextApiResponse } from 'next'
// import prisma from "@/lib/prisma";



// export default  async function handler(
//   req: NextApiRequest,
//   res: NextApiResponse
// ) {
 
//   try {
    
//     var count = 0;
    
//     // =============== find all the tasks
//     const tasks = await prisma.task.findMany()

//     for (const task of tasks){
//         // ----------- create for each task, 2 drafts.
//         await prisma.drafts.create({data:{taskId:task.id,userId:1, type:"Comment", projectId:projectId, saved:false }})
//         await prisma.drafts.create({data:{taskId:task.id,userId:1, type:"Description", projectId:projectId, saved:false }})    }

//   } catch (error) {
//       console.log(error)
//       return res.status(500).json(error)
//   }
// }
