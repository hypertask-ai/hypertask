// Assuming you have already initialized Prisma and have access to the PrismaClient instance.
import { stripe } from '@/lib/subscription';

import prisma from "@/lib/prisma";
import getFirst from "./getFirst";
import isProjectAdmin from "./isProjectAdmin";



const deleteProject = async(currProjectID:number, userId:number) =>{
  // Check if the request is a POST request

    try {
        const project = await prisma.project.findFirst({
            where:{
                id:currProjectID,
                status:"Normal"
            }
         })
      if (!currProjectID || !userId || !project?.teamId)
        return ({
          status:400,
          json:{message:"Missing Required Data"}
        })
      if (!(await isProjectAdmin(userId, currProjectID)))
        return ({
          status:401,
          json:{message:"Only Board owner or admin can delete this board."}
        })
      // Find the project by ID and update the sections array
      console.log("============================= DELETING PROJECT ==================")
      const updatedProject = await prisma.project.update({
        where: { id: currProjectID },
        data: {
          status:"Deleted"
        },
      });
      
      // =========== delete from favorites
      await prisma.favorites.deleteMany({
        where:{
          projectId: currProjectID,
        }
      })
      console.log("🚀 ~ file: delete.ts:28 ~ addSection ~ updatedProject:", updatedProject)


    // ====================================================================
    // =========================== DELETE ALL TASKS
    // ====================================================================

    console.log("============================= DELETING ALL TASKS ==================")
      const deleted_tasks = await prisma.task.updateMany({
        where:{
            projectId:currProjectID
        },
        data:{
            status:"Deleted"
        }
      })
      console.log("🚀 ~ file: delete.ts:32 ~ addSection ~ deleted_tasks:", deleted_tasks)

    // ====================================================================
    // =========================== DELETE ALL NOTIFICATIONS
    // ====================================================================

    console.log("============================= DELETING ALL NOTIFICATIONS ==================")
      const deleted_notis = await prisma.notification.updateMany({
        where:{
            projectId:currProjectID
        },
        data:{
            status:"Deleted"
        }
     })
     console.log("🚀 ~ file: delete.ts:43 ~ addSection ~ deleted_notis:", deleted_notis)
     
    // ====================================================================
    // =========================== DELETE ALL MEMBERS AND OFCOURSE HANDLE TOTAL SEATS FOR THE RESPECTIVE TEAM. 
    // ====================================================================
    console.log("============================= FIND ALL MEMBERS OF THAT PROJECT ==================")

    const allMembers = await prisma.member.findMany({
        where:{
            projectId:project.id
        }
    })
    console.log("count of all members : ", allMembers.length)
    console.log("============================= DELETING ALL MEMBERS ==================")

    for (const member of allMembers){

        console.log(" ----------  member: ", member.id)
        // ========================== MEMBER DELETE
        const deleted_members = await prisma.member.deleteMany({
           where:{
                id:member.id,
               projectId:currProjectID
           },
        })
        console.log("🚀 ~ file: delete.ts:84 ~ addSection ~ deleted_members:", deleted_members)
   
       // =========================== FIND ALL PROJECTS OF THAT SPECIFIC TEAM IM STILL A MEMBER OF
        const projectsWhereStillMember = await prisma.member.findMany({
           where:{
   
               project:{
                   teamId:project.teamId
               }
           }
         })  
         console.log("teams that user is still a part of: ", projectsWhereStillMember)
        //  if (projectsWhereStillMember.length===0){
   
        //      const deletedTeamMember=  await prisma.member_Team.deleteMany({
        //            where:{
        //                teamId:project.teamId
        //            }
        //        })
        //        await prisma.team.update({
        //            where:{
        //                id:project.teamId
        //            },
        //            data:{
        //                totalSeats:{
        //                    decrement:1
        //                }
        //            }
        //        })
        //        const updated_team = await prisma.team.findFirst({
        //         where:{
        //             id:project.teamId
        //         }
        //        })
        //        if(updated_team?.activeSubscriptionPlanItemId)
        //        await stripe.subscriptionItems.update(
        //         updated_team.activeSubscriptionPlanItemId,
        //            {
        //                quantity:updated_team.totalSeats
        //            }
        //          );
        //        console.log("------------ updated TeamId: ", updated_team)
        //  }
    }


      const firstProject = await getFirst(userId)

      return ({
        status:200,
        json:{message:"Success", firstProject: firstProject.json}
      })
    } catch (error) {
      console.error(error);
      return ({
        status:500,
        json:{ error: 'Failed to add new section' }
      })
    }

}

export default deleteProject
