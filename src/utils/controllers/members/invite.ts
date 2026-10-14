import { recordActivationOccurrence } from "@/lib/telemetry/activationOccurrences";
import { LogType, PrismaClient, Status } from "@prisma/client";
import { CreateLogInput } from "@/models/model";
import createLog from "../logs/createLog";

import prisma from "@/lib/prisma";
import { withTeamSeatBillingLock } from "@/lib/seatBillingLock";
import { ensureTeamMembership } from "@/lib/teamMembership";
import { updateTrial } from "./updateTrial";
import { mutateAndSyncSeatBilling } from "@/lib/syncSeatBilling";


const membersInvite = async (userId:number, projectId:number, inviteKey?:string) => {
        try {
            if (!userId || !projectId) {
                return({status:400,  json:{message:"Missing required information"}})
            }
            const user = await prisma.user.findUnique({
                where: {
                    id: userId
                }
            })
            if (!user) {
                return({status:400, json:{message:"User not found"}})
            }

            const project = await prisma.project.findFirst({
                where: {
                    id: projectId,
                    status:"Normal"
                    
                },
                include:{
                    team:{
                        include:{
                            googleAccount:true,
                            subscriptionPlan:{
                                where:{
                                    subscriptionStatus:{not:"Expired"}
                                }
                            }
                        }
                    }
                }
            })

            if (!project)  return({status:400, json:{ message:"Project not valid"}})
            

            if(project.ownerId === userId ) return({status:400, json:{ message:"Cannot invite project owner"}})
            let trialStatus: boolean = false;
            let member = await prisma.member.findFirst({
                where: {
                    userId: userId,
                    projectId: projectId,
                    agentId: null
                },
                include:{
                    user:true
                }
            })
            if (member) return({status:101, json:[]})


            console.log("🚀 ~ membersInvite ~ inviteKey:", inviteKey)
            if (inviteKey){
                const fetchedInvite = await prisma.invite.findFirst({
                    where:{
                        id:inviteKey,
                        expired:false
                    },
                    include:{
                        project:{
                            include:{

                                team:true
                            }
                        },
                        invitedBy: true
                    },

                })
                console.log("🚀 ~ file: invite.ts:62 ~ membersInvite ~ fetchedInvite:", fetchedInvite)
                
                if (!fetchedInvite||fetchedInvite?.expired===true){
                    console.log("🚀 invite might be expired")
                    return({status:101, json:[]})

                }

                if (fetchedInvite.projectId !== Number(projectId)
                    || (fetchedInvite.expiresAt && fetchedInvite.expiresAt <= new Date())) {
                    return({status:403, json:{message:"Invite not valid for this board"}})
                }


                const member_teamCheck = await prisma.member_Team.findFirst({
                    where:{
                        userId:userId,
                        teamId:project.team?.id,
                        status:"Accepted",
                    }
                })
                const ownsTheTeam = await prisma.team.findUnique({
                    where:{
                        id:project.team?.id,
                    },
                    include:{
                        googleAccount:true
                    }
                })
                console.log("🚀 ~ membersInvite ~ ownsTheTeam:", ownsTheTeam)
                console.log("🚀 ~ file: invite.ts:100 ~ membersInvite ~ member_teamCheck:", member_teamCheck)
                var PaymentResponse: "Awaiting" | "FREE" | "OK"  = "Awaiting";
                
                if (project.teamId && project.team?.stripe_customer_id && !member_teamCheck && ownsTheTeam?.googleAccount.userId!==userId){
                    console.log("🚀 ~ membersInvite ~ project.team.subscriptionPlan:", project.team.subscriptionPlan)
                    const teamId = project.teamId;
                    const team = project.team;
                    PaymentResponse = project.team.subscriptionPlan.length===0 ? "FREE" : "OK"
                    
                    if (PaymentResponse==="OK" || PaymentResponse ==="FREE"){
                        await mutateAndSyncSeatBilling(teamId, async (assertHeld) => {
                          assertHeld();
                          const { member: member_team, created } = await ensureTeamMembership({
                                teamId,
                                userId:userId,
                                googleAccountId:team.googleAccountId,
                          })

                          if (!created) return { value: undefined, sync: false };
                        let createLogBody:CreateLogInput = {
                            log:`${member_team?.user.displayName} joined Team "${team.title}"`,
                            type:LogType.Team,
                            status:Status.Normal,
                            LoggedById:userId
                          }
                          createLog(createLogBody)
                          
                        console.log("creating a team member")
                        
                       assertHeld();
                       const updatedTeam= await prisma.team.update({
                            where:{
                                id:teamId,
                            },
                            data:{
                                totalSeats:{
                                    increment:1
                                }
                            }
                        })
                        let createLogBody2:CreateLogInput = {
                            log:`Team "${updatedTeam.title}" has now ${updatedTeam.totalSeats} active team members `,
                            type:LogType.Team,
                            status:Status.Normal,
                            LoggedById:userId
                          }
                          createLog(createLogBody2)

                       console.log("🚀 ~ file: invite.ts:144 ~ membersInvite ~ updatedTeam:", updatedTeam)

                        
    
                          return { value: undefined, sync: true };
                        })
                    }

                }


                if (project.teamId && (member_teamCheck || PaymentResponse==="OK" || PaymentResponse==="FREE" ||ownsTheTeam)){
                    await withTeamSeatBillingLock(project.teamId, async (assertHeld) => {
                    assertHeld();
                    const acceptedTeamMember = await prisma.member_Team.findUnique({
                        where:{ userId_teamId:{ userId, teamId:project.teamId! } },
                        select:{ status:true }
                    })
                    assertHeld();
                    if (acceptedTeamMember?.status !== "Accepted") return;
                    
                    
                    const alreadyMember = await prisma.member.findFirst({
                        where:{
                            projectId,
                            userId,
                            agentId: null
                        }
                    })
                    const owner = await prisma.project.findMany({
                        where:{
                            AND:[
                                {
                                    id:projectId
                                },
                                {
                                    ownerId:userId
                                }
                            ]
                        }
                    })
                    console.log("🚀 ~ membersInvite ~ owner:", owner)
                    if (!alreadyMember && owner.length===0){
                        assertHeld();
                        await prisma.invite.update({
                            where: {
                              id: fetchedInvite?.id
                            },
                            data: {
                                
                              uses: {
                                decrement: 1
                              },
                              expired:fetchedInvite?.uses===1?true:false,
                              emails:{
                                push: user.email
                              }        
                            },
                            
                          });
                        assertHeld();
                        await prisma.notification.updateMany({
                            where:{
                                notification_invite:{
                                    inviteId:fetchedInvite?.id
                                },
                            
                            },
                            data:{seen:true}
                        })

                        const doubleCheck = await prisma.member.findFirst({
                            where:{
                                projectId,
                                userId,
                                agentId: null
                            }
                            })
                        if (!doubleCheck){
                            assertHeld();
                            member = await prisma.member.create({
                                data: {
                                    userId: userId,
                                    projectId: projectId
                                },
                                include:{
                                    user:true,
                                    project:{
                                        include:{
                                            team:true
                                        }
                                    }
                                }
                            })

                            recordActivationOccurrence(fetchedInvite.userId, "invite_accepted", `${fetchedInvite.id}:${userId}`, { inviteeId: userId });

                            if(PaymentResponse ==="OK" || PaymentResponse === "Awaiting") {
                                await updateTrial(userId)
                                assertHeld();
                                trialStatus = true;
                            }
                            
                            console.log("🚀 ~ file: invite.ts:191 ~ membersInvite ~ member:", member)
                            let createLogBody:CreateLogInput = {
                                log:`${member?.user.displayName} accepted an invitation for "${fetchedInvite.project.title}"`,
                                type:LogType.Invite,
                                status:Status.Normal,
                                LoggedById:userId
                              }
                              createLog(createLogBody)
                            
                        }

                    }
                    })
                }

                return({status:200, json:{member, trialStatus}})

            }
            
            return({status:101, json:[]})
        } catch (error) {
            console.log(error);
            return({status:500, json:{message:JSON.stringify(error)}})
        }

};

export default membersInvite;
