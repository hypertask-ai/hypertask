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
                // return res.status(400).json({ message: "Missing required information" });
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
                
                // invitation link expired
                if (!fetchedInvite||fetchedInvite?.expired===true){
                    console.log("🚀 invite might be expired")
                    return({status:101, json:[]})

                }
            

                // before we create a new instance of member_team, we must confirm that a user with same team id doesn't exist.
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
                
                // ===================== CREATE TEAM MEMBER
                // ================================ if member_teamCheck is null, it means we need to add this new member and also that we have to charge the owner. 
                // ============ also check if the invited user is owner. then don't 
                if (project.teamId && project.team?.stripe_customer_id && !member_teamCheck && ownsTheTeam?.googleAccount.userId!==userId){
                    console.log("🚀 ~ membersInvite ~ project.team.subscriptionPlan:", project.team.subscriptionPlan)
                    const teamId = project.teamId;
                    const team = project.team;
                    // Seat billing runs once, after the member is added, so it can price against
                    // the team's real seat count. Charging here as well is what double-billed a
                    // seat (HTPR-4216).
                    PaymentResponse = project.team.subscriptionPlan.length===0 ? "FREE" : "OK"
                    
                    // // ========== payment is confirmed, add to the team.
                    // If Seated then that means an invoice was made
                    if (PaymentResponse==="OK" || PaymentResponse ==="FREE"){
                        // CREATE new instance of MEMBER_TEAM if doesnt exist before

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
                        
                        // update total_seats of the team
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

                // ================================ after creating an instance of the team member, finally let the person in the project. 
                // ================================ redeem the invite code. 

                // but DO NOT ADD IN PROJECT if payment is awaiting and user isn't in team.
                // ONLY ADD if either the payment went through, or the member is part of the team. 
                if (project.teamId && (member_teamCheck || PaymentResponse==="OK" || PaymentResponse==="FREE" ||ownsTheTeam)){
                    await withTeamSeatBillingLock(project.teamId, async (assertHeld) => {
                    assertHeld();
                    const acceptedTeamMember = await prisma.member_Team.findUnique({
                        where:{ userId_teamId:{ userId, teamId:project.teamId! } },
                        select:{ status:true }
                    })
                    assertHeld();
                    if (acceptedTeamMember?.status !== "Accepted") return;
                    
                    
                    // ================================ create a member of the project if he isn't a member
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

                        // yeah i know its bad but for some reason this block runs twice
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

                            if(PaymentResponse ==="OK" || PaymentResponse === "Awaiting") {
                                // Awaited on purpose. The response reports trialStatus: true either
                                // way, so a floating write that the serverless function never
                                // finishes leaves the user in a paid team still counting down
                                // their trial (HTPR-3554).
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


            // res.status(200).json(member);
        } catch (error) {
            console.log(error);
            return({status:500, json:{message:JSON.stringify(error)}})

            // return res.status(400).json({ message: JSON.stringify(error) });
        }

};

export default membersInvite;
