import prisma from "@/lib/prisma";

const getAllTeamsSidebarOptimized = async (userId: number) => {
    try {
        if (!userId) {
            return {
                status: 304,
                json: []
            };
        }

        // Ultra-optimized single query - minimal data only
        const teams = await prisma.team.findMany({
            where: {
                OR: [
                    // Teams the user owns
                    {
                        googleAccount: { 
                            userId: userId 
                        }
                    },
                    // Teams where user has projects (member or owner)
                    {
                        projects: {
                            some: {
                                OR: [
                                    { ownerId: userId },
                                    { members: { some: { userId: userId } } }
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
                            { members: { some: { userId: userId } } }
                        ],
                        status: "Normal"
                    },
                    select: {
                        id: true,
                        title: true,
                        name: true,
                        ownerId: true,
                        // Human members only - needed for sidebar avatars.
                        // Agents share the owner's photo, so they don't get an
                        // avatar; they're summarized by the _count below.
                        members: {
                            where: { agentId: null },
                            select: {
                                user: {
                                    select: {
                                        photoURL: true
                                    }
                                }
                            },
                            take: 8 // Limit to first 8 avatars for performance
                        },
                        // Accurate agent count for the sidebar's "+robot N"
                        // indicator (independent of the avatar take limit).
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
                    take: 50 // Limit projects per team for performance
                },
                stripe_customer_id: true,
                activeSubscriptionPlanId:true,
                compedUntil: true,
                subscriptionPlan:{
                    select:{
                        id:true,
                        priceId:true
                    }
                }
            }
        });

        // Filter out teams with no projects (done in memory for better performance)
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
