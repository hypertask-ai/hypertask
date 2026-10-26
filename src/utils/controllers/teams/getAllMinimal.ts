

import { ITeam } from "@/models/model";

import prisma from "@/lib/prisma";


const getAllTeamsMinimal = async (userId:number) => {
        try {
            if (!userId) {
                
                return ({
                    status:304,
                    json:[]
                })
            }
            const owner = await prisma.user.findUnique({where:{id:userId}})
            if (!owner) {
                return ({
                    status:400,
                    json:[]
                })
            }

            const owned_teams = await prisma.team.findMany({
                where:{
                    googleAccountId:owner.accountId??"",
                },
               
            })
            console.log("🚀 ~ getAllTeamsMinimal ~ owned_teams:", owned_teams.map(team => ({
                teamId: team.id,
                hasCustomer: Boolean(team.stripe_customer_id)
            })))
            const participating_teams = await prisma.member_Team.findMany({
                
                where: {
                    userId: parseInt(userId.toString()),
                },
                include:{
                    team:true
                }
            })
            console.log("🚀 ~ getAllTeamsMinimal ~ participating_teams:", participating_teams.map(({ team }) => ({
                teamId: team.id,
                hasCustomer: Boolean(team.stripe_customer_id)
            })))

            return ({
                status:200,
                json:[...owned_teams, ...participating_teams.map(x=>x.team)]
            })
        } catch (error) {
            console.log(error);
            return ({
                status:400,
                json:[]
            })
        }

};

export default getAllTeamsMinimal;