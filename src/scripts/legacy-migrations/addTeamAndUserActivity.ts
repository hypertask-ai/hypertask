// // Next.js API route support: https://nextjs.org/docs/api-routes/introduction

// import type { NextApiRequest, NextApiResponse } from 'next'
// import prisma from "@/lib/prisma";



// export default  async function handler(
//   req: NextApiRequest,
//   res: NextApiResponse
// ) {
 
//   try {
//     // lets add USER activity first. 

//     debug.log("============ GETTING ALL USERS ===========")
//     const allUsers = await prisma.user.findMany()
//     var usersDone = 0;
//     debug.log("----- Starting Script on Users -------")
//     for (const user of allUsers){
//         const updated = await prisma.user_Activity.update({
//             where:{
//                 userId:user.id
//             },
//             data:{
//                 lastActiveAt:null
//             }
//         })
//         debug.log("🚀 ~ updated:", updated)
//         // //  get total teams created for a user.
//         // const teamsCreated = await prisma.team.count({
//         //         where:{
//         //             googleAccount:{
//         //                 userId:user.id
//         //             }
//         //         }
//         //     }
//         // )
//         // // create the activity element
//         // await prisma.user_Activity.create({
//         //     data:{
//         //         totalTeamsOwned:teamsCreated,
//         //         userId:user.id,

//         //     }
//         // })
//         usersDone++;
//         debug.log("============== completed users: ", usersDone)


//     } 
//     debug.log("=========== OPERATION COMPLETED ON USERS ===========")
//     debug.log("============ GETTING ALL Teams ===========")

//     // NOW ADD TEAM ACTIVITY.
//     const allTeams = await prisma.team.findMany()
//     var teamsDone = 0;
//     debug.log("----- Starting Script on Teams -------")

//     for (const team of allTeams){
//         // const totalTasksCount = await prisma.task.count({where:{project:{teamId:team.id}}})
//         // const teamActivity = await prisma.team_Activity.create({
//         //     data:{
//         //         teamId:team.id,
//         //         total_tasks:totalTasksCount,

//         //     }
//         // })
//         const updated= await prisma.team_Activity.update({
//             where:{teamId:team.id},
//             data:{
//                 lastActiviyAt:null
//             }
//         })
//         debug.log("🚀 ~ updated:", updated)
//         teamsDone++;
//         debug.log("============== completed teams: ", teamsDone)

//     }

//     return res.status(200).json({teamsDone,usersDone})
//     await prisma.user_Activity.updateMany({
//         data:{
//             lastActiveAt:undefined
//         }
//     })
//     await prisma.team_Activity.updateMany({
//         data:{
//             lastActiviyAt:undefined
//         }
//     })
//   } catch (error) {
//       debug.log(error)
//       return res.status(500).json(error)
//   }
// }
