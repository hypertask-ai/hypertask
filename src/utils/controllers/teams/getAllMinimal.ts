

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

            // ========================== after confirming that the owner is present, first find the teams he OWNS.
            const owned_teams = await prisma.team.findMany({
                where:{
                    googleAccountId:owner.accountId??"",
                },
               
            })
            console.log("🚀 ~ getAllTeamsMinimal ~ owned_teams:", owned_teams)
            const participating_teams = await prisma.member_Team.findMany({
                
                where: {
                    userId: parseInt(userId.toString()),
                },
                include:{
                    team:true
                }
            })
            console.log("🚀 ~ getAllTeamsMinimal ~ participating_teams:", participating_teams)

            // const projectIds = member_project.map((item) => item.projectId)

            // const participating_teams = await prisma.team.findMany({
            //     where:{
            //         projects:{
            //             some:{

            //                 id:{
            //                     in:projectIds,
            //                 }
            //             }
            //         }
            //     },
            // })
                    
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