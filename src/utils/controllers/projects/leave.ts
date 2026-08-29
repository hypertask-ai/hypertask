import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import { IProject } from "@/models/model";
import { stripe } from "@/lib/subscription";

import prisma from "@/lib/prisma";
import getFirst from "./getFirst";


const leaveProject = async (projectId:number, userId:number) => {
        try {
            if (!projectId) {
                return({
                    status:400,
                    json:{ message: "User id is required" }
                })
            }
            
            const project:any = await prisma.project.findUnique({
                where: {
                    id: projectId,
                    
                },
                include:{
                    members:true,
                    owner:true
                }
            })

            if (!project && project?.ownerId===userId) {
                return({status:400, json:{ message:"Project not valid"}})

                // return res.status(400).json({ message: "Project not valid" });
            }
     
            // first delete yourself from the members. 
            const member = await prisma.member.findFirst({
                where:{
                    userId,
                    projectId,
                    agentId: null
                }
            })

            const memberAgents = await prisma.member.findMany({
                where:{
                    userId:userId,
                    projectId:projectId,
                    agentId: { not: null }
                }
            })

            //Removing agents from board when user leaves
            for (const agent of memberAgents) {
                await prisma.member.delete({
                    where:{
                        id:agent.id
                    }
                })
            }

            //Removing the user from the board
            await prisma.member.delete({
                where:{
                    id:member?.id,
                    
                }
            })

            // first check if the user memberis in any of the projects that belongs to the current project's team, and IF NONE, THEN DELETE
            // if it comes as null, it means that means that the member we are removing is in none of the projects of that team
            // only then should we delete member_team instance and decrement the total seats.
            // const projectsWhereStillMember = await prisma.member.findMany({
            //     where:{
            //         userId:member?.userId,
            //         project:{
            //             teamId:project.teamId
            //         }
            //     }
            //   })  
            //   console.log("🚀 ~ file: removeMember.ts:61 ~ membersRemove ~ projectsWhereStillMember:", projectsWhereStillMember)
            //   if (projectsWhereStillMember.length===0 && project.teamId){

            //       const deletedTeamMember=  await prisma.member_Team.deleteMany({
            //             where:{
            //                 userId:userId,
            //                 teamId:project.teamId
            //             }
            //         })
            //         const updatedTeam=await prisma.team.update({
            //             where:{
            //                 id:project.teamId
            //             },
            //             data:{
            //                 totalSeats:{
            //                     decrement:1
            //                 }
            //             }
            //         })
            //          // update totalseats in stripe if that team has a subcriptionItemId
            //          if(updatedTeam.activeSubscriptionPlanItemId)
            //          await stripe.subscriptionItems.update(
            //              updatedTeam.activeSubscriptionPlanItemId,
            //              {
            //                  quantity:updatedTeam.totalSeats
            //              }
            //            );

            //   }

            const firstProject = await getFirst(userId)

            return({
                status:200,
                json:{message:"Success", firstProject: firstProject.json}
            })
        } catch (error) {
            console.log(error);
            return({
                status:400,
                json:{ message: JSON.stringify(error) }
            })
        }
    
};

export default leaveProject;