
import { stripe } from "@/lib/subscription";

import prisma from "@/lib/prisma";
import isProjectAdmin from "./isProjectAdmin";


const membersRemove = async (userId:number, projectId:number, actingUserId:number) => {
        try {
            if (!userId || !projectId || !actingUserId) {
                return({status:400,  json:{message:"Missing required information"}})
                // return res.status(400).json({ message: "Missing required information" });
            }
            if (!(await isProjectAdmin(actingUserId, projectId))) {
                return({status:401, json:{message:"Only Board owner or admin can remove members"}})
            }
            const user = await prisma.user.findUnique({
                where: {
                    id: userId
                }
            })
            if (!user) {
                return({status:400, json:{message:"User not found"}})
                // return res.status(400).json({ message: "User not found" });
            }

            const project = await prisma.project.findUnique({
                where: {
                    id: projectId
                }
            })
            if (!project) {
                return({status:400, json:{ message:"Project not valid"}})

                // return res.status(400).json({ message: "Project not valid" });
            }

            if(project.ownerId === userId) {
                return({status:400, json:{ message:"Cannot remove project owner"}})

                // return res.status(400).json({ message: "Cannot invite project owner" });
            }
            const member = await prisma.member.findFirst({
                where:{
                    userId:userId,
                    projectId:projectId,
                    agentId: null,
                }
            })

            const memberAgents = await prisma.member.findMany({
                where:{
                    userId:userId,
                    projectId:projectId,
                    agentId: { not: null }
                }
            })

            //Removing member's agents from board when member is removed
            for (const agent of memberAgents) {
                await prisma.member.delete({
                    where:{
                        id:agent.id
                    }
                })
            }

            //Removing member from the board
            // HTPR-4162: this was `where: { id: member?.id }`. When the member row
            // was already gone (removed twice, or the user was only on the board
            // through agents) that is `id: undefined`, which Prisma rejects — so
            // the request threw and returned 400 even though the agent rows above
            // had already been deleted. Removal is idempotent: no row means the
            // caller already has what they asked for.
            if (member) {
                await prisma.member.delete({
                    where:{
                        id:member.id,
                    }
                })
            }
            // if (project.teamId){
            
            // // first check if the user is in any of the projects that belongs to the current project's team, and IF NONE, THEN DELETE
            // // if it comes as null, it means that means that the member we are removing is in none of the projects of that team
            // // only then should we delete member_team instance and decrement the total seats.
            //   const projectsWhereStillMember = await prisma.member.findMany({
            //     where:{
            //         userId:member?.userId,
            //         project:{
            //             teamId:project.teamId
            //         }
            //     }
            //   })  
            //   console.log("🚀 ~ file: removeMember.ts:61 ~ membersRemove ~ projectsWhereStillMember:", projectsWhereStillMember)
            //   if (projectsWhereStillMember.length===0){

            //       const deletedTeamMember=  await prisma.member_Team.deleteMany({
            //             where:{
            //                 userId:member?.userId,
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
            //         if(updatedTeam.activeSubscriptionPlanItemId)
            //         await stripe.subscriptionItems.update(
            //             updatedTeam.activeSubscriptionPlanItemId,
            //             {
            //                 quantity:updatedTeam.totalSeats
            //             }
            //           );
            //       console.log("🚀 ~ file: removeMember.ts:60 ~ membersRemove ~ deletedTeamMember:", deletedTeamMember)
            //   }
            // }
            // let member = await prisma.member.findFirst({
            //     where: {
            //         userId: userId,
            //         projectId: projectId
            //     }
            // })

            // if (member) {
            //     return({status:400, json:member})
            //     // return res.status(200).json(member);
            // }

            // member = await prisma.member.create({
            //     data: {
            //         userId: userId,
            //         projectId: projectId
            //     }
            // })
            return({status:200, json:["Success"]})

            // res.status(200).json(member);
        } catch (error) {
            console.log(error);
            return({status:400, json:{message:JSON.stringify(error)}})

            // return res.status(400).json({ message: JSON.stringify(error) });
        }

};

export default membersRemove;
