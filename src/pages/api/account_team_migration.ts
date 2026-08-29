import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import update_or_create_user from "@/utils/controllers/users/update_or_create_user";
import { stripe } from "@/lib/subscription";

import prisma from "@/lib/prisma";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    try {

    // ========================== GET ALL USERS ==========================
        const allUsers = await prisma.user.findMany({
            include:{
                projects:{
                    include:{
                        members:true
                    }
                }
            }
        })
        console.log("total users found: ", allUsers.length)
        console.log("user names and ids: ", allUsers.map(item=>({id:item.id, name:item.displayName})))
    
        console.log("=================== RUNNING LOOP THROUGH ALL USERS =============")

    // =====================================================================================
    // ====================== LOOP THROUGH ALL USERS IN HYPERTASKS =========================
    // =====================================================================================
        
        for (const user of allUsers){
            console.log("current User: ", user.displayName)
        
        // =============== CREATE stripe customer for each user, IF DOESNT EXIST
            
            const customer = await stripe.customers.create({
                email: String(user?.email)
            })
            console.log(`${user.displayName}'s stripe id is: `, customer.id)
            
        
        // ============== CREATE googleAccount record for each user and attach stripe_customer_id.
            const googleAccount = await prisma.googleAccount.create({
                data:{
                    userId:user.id,
                    stripe_customer_id:customer.id
                }
            })
            // ----- update user with the customer stripe id
            await prisma.user.update({
                where:{
                    id:user.id,
                },
                data:{
                    accountId:googleAccount.id,
                    stripe_customer_id:customer.id,

                }
            })
            console.log(`${user.displayName}'s googleAccount created is: `, googleAccount)
      
        // ============== CREATE Team Instance and give it the google account from above. 
            const Team = await prisma.team.create({
                data:{
                    title:user.displayName+"'s Team",
                    googleAccountId:googleAccount.id,
                    totalSeats:1,
                }
            })
            console.log(`${user.displayName}'s owns this team: `, Team)

        // -------------------------------------------------------------------------------------
        // ---------------------- LOOP THROUGH ALL THE PROJECTS THAT THE USER OWNS--------------
        // -------------------------------------------------------------------------------------
            console.log("===============================================")
            console.log(`Now Looping through ${user.displayName}'s owned Projects`, user.projects.map(item=>item.title))
            console.log("===============================================")

            for (const project of user.projects){
                
                // ===================== UPDATE each project to add teamId and googleAccountId
                const updatedProject = await prisma.project.update({
                    where:{
                        id:project.id
                    },
                    data:{
                        teamId:Team.id,
                        googleAccountId:googleAccount.id
                    }
                })
                console.log(`Updated ${project.title}`, updatedProject)

                // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
                // ---------------------- LOOP THROUGH ALL THE MEMBERS OF THE PROJECT ------------------
                // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
                // ===================== CREATE TEAM MEMBER INSTANCE ONLY IF THE USER HASN'T BEEN ADDED EARLIER
                for (const member of project.members){

                    // first check if the user already is in this team.
                    const memberCheck = await prisma.member_Team.findFirst({
                        where:{
                            userId:member.userId,
                            teamId:Team.id
                        }
                    })


                    // if the user DOESNT EXIST, then CREATE a Member_Team instance
                    if (!memberCheck){
                        console.log(`User ${user.displayName} doesn't exist in ${Team.title}`, user.projects.map(item=>item.title))

                        const Member_Team = await prisma.member_Team.create({
                            data:{
                                userId:member.userId,
                                teamId:Team.id,
                                googleAccountId:googleAccount.id,
                            }
                        })
                        console.log("🚀 ~ file: account_team_migration.ts:115 ~ consthandler:NextApiHandler= ~ Member_Team:", Member_Team)

                        // UPDATE the respective team to have 1 more seat.
                        const updatedTeam = await prisma.team.update({
                            where:{
                                id:Team.id,
                            },
                            data:{
                                totalSeats:{
                                    increment:1
                                }
                            }
                        })
                        console.log("🚀 ~ file: account_team_migration.ts:127 ~ consthandler:NextApiHandler= ~ updatedTeam:", updatedTeam)

                    }
                    
                }

            }
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal server error" });
    }
    finally{

    }
};

export default handler;