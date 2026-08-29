

import { ITeam } from "@/models/model";

import prisma from "@/lib/prisma";


const getAllTeams = async (userId:number) => {
        try {
            if (!userId) {
                
                return ({
                    status:304,
                    json:[]
                })
            }
            const owner = await prisma.googleAccount.findFirst({
                where: {
                    userId: parseInt(userId.toString())
                }
            })
            if (!owner) {
                return ({
                    status:400,
                    json:[]
                })
            }

            // ========================== after confirming that the owner is present, first find the teams he OWNS.
            const owned_teams = await prisma.team.findMany({
                where:{
                    googleAccountId:owner.id
                },
                include:{
                    projects:{
                        include: {
                            tasks: {
                                include: {
                                    assignees: {
                                        include: {
                                            user: true
                                        }
                                    },
                                    comments: {select: {id: true}},
        
                                },
                                where: {status: 'Normal'},
                                
                            },
                            members: {include: {user: true}},
                            owner:true,
                            section:{
                                where:{
                                    deleted:false,
                                    visibility:true
                                },
                                orderBy:{
                                    ranking:"asc"
                                }
                            },
                            team:true
        
                        },
                        orderBy: {
                            id: 'asc'
                        }
                    }
                }
            })
            const member_project = await prisma.member.findMany({
                select: {
                    projectId: true,
                    userId: true
                },
                where: {
                    userId: parseInt(userId.toString())
                }
            })

            const projectIds = member_project.map((item) => item.projectId)

            const participating_teams = await prisma.team.findMany({
                where:{
                    projects:{
                        some:{

                            id:{
                                in:projectIds,
                            }
                        }
                    }
                },
                include:{
                    projects:{
                        where:{

                            id:{
                                in:projectIds
                            }
                        },
                        include: {
                            tasks: {
                                include: {
                                    assignees: {
                                        include: {
                                            user: true
                                        }
                                    },
                                    comments: {select: {id: true}},
        
                                },
                                where: {status: 'Normal'},
                                
                            },
                            members: {include: {user: true}},
                            owner:true,
                            section:{
                                where:{
                                    deleted:false,
                                    visibility:true
                                },
                                orderBy:{
                                    ranking:"asc"
                                }
                            },
                            team:true
        
                        },
                        orderBy: {
                            id: 'asc'
                        }
                    }
                }
            })
                    
            return ({
                status:200,
                json:[...owned_teams, ...participating_teams]
            })
        } catch (error) {
            console.log(error);
            return ({
                status:400,
                json:[]
            })
        }

};

export default getAllTeams;