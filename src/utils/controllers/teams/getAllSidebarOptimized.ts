import prisma from "@/lib/prisma";

const getAllTeamsSidebarOptimized = async (userId: number) => {
    try {
        if (!userId) {
            return {
                status: 304,
                json: []
            };
        }

        const teams = await prisma.team.findMany({
            where: {
                OR: [
                    {
                        googleAccount: { 
                            userId: userId 
                        }
                    },
                    {
                        projects: {
                            some: {
                                OR: [
                                    { ownerId: userId },
                                    { members: { some: { userId: userId, agentId: null } } }
                                ],
                                status: "Normal"
                            }
                        }
                    }
                ]
            },
            select: {
                id: true,
                title: true,
                googleAccountId: true,
                googleAccount: {
                    select: {
                        id: true,
                        userId: true
                    }
                },
                projects: {
                    where: {
                        OR: [
                            { ownerId: userId },
                            { members: { some: { userId: userId, agentId: null } } }
                        ],
                        status: "Normal"
                    },
                    select: {
                        id: true,
                        title: true,
                        name: true,
                        ownerId: true,
                        members: {
                            where: { agentId: null },
                            select: {
                                user: {
                                    select: {
                                        photoURL: true
                                    }
                                }
                            },
                            take: 8
                        },
                        _count: {
                            select: {
                                members: {
                                    where: { agentId: { not: null } }
                                }
                            }
                        },
                        owner: {
                            select: {
                                id: true,
                                displayName: true,
                                photoURL: true
                            }
                        },
                        team: {
                            select: {
                                id: true,
                                title: true
                            }
                        }
                    },
                    orderBy: {
                        id: 'asc'
                    },
                    take: 50
                },
                stripe_customer_id: true,
                activeSubscriptionPlanId:true,
                compedUntil: true,
                compedPlan: true,
                subscriptionPlan:{
                    select:{
                        id:true,
                        priceId:true
                    }
                }
            }
        });

        const filteredTeams = teams.filter(team => team.projects.length > 0);

        return {
            status: 200,
            json: filteredTeams
        };

    } catch (error) {
        console.error("❌ getAllTeamsSidebarOptimized error:", error);
        return {
            status: 400,
            json: []
        };
    }
};

export default getAllTeamsSidebarOptimized;
