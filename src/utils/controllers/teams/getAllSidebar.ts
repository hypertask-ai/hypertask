import prisma from "@/lib/prisma";

const getAllTeamsSidebar = async (userId: number) => {
    try {
        console.log("getAllTeamsSidebar called with userId:", userId);

        if (!userId) {
            console.log("No userId provided");
            return ({
                status: 304,
                json: []
            })
        }

        const owner = await prisma.googleAccount.findFirst({
            where: {
                userId: parseInt(userId.toString())
            }
        })
        console.log("Owner found:", owner);

        if (!owner) {
            console.log("No owner found for userId:", userId);
            return ({
                status: 400,
                json: []
            })
        }

        // ========================== Get teams the user OWNS
        const owned_teams = await prisma.team.findMany({
            where: {
                googleAccount: { userId: parseInt(userId.toString()) },
            },
            include: {
                projects: {
                    where: {
                        OR: [
                            {
                                ownerId: parseInt(userId.toString())
                            },
                            {
                                members: { some: { userId: userId } }
                            }
                        ],
                        status: "Normal",
                        googleAccount: { isNot: null },
                        teamId: { not: null },
                    },
                    include: {
                        members: { select: { user: { select: { photoURL: true } } } },
                        owner: true,
                        team: true,
                    },
                    orderBy: {
                        id: 'asc'
                    }
                },
                googleAccount: true
            }
        })
        console.log("Owned teams:", owned_teams);

        // ========================== Get projects where user is a member
        const member_projects = await prisma.member.findMany({
            select: {
                projectId: true,
                userId: true
            },
            where: {
                userId: parseInt(userId.toString())
            }
        })
        console.log("Member projects:", member_projects);

        // Extract project IDs where user is a member
        const memberProjectIds = member_projects.map((item) => item.projectId);
        console.log("Member project IDs:", memberProjectIds);

        // ========================== Get teams where user participates (but doesn't own)
        const participating_teams = await prisma.team.findMany({
            where: {
                // Teams that the user does NOT own
                NOT: {
                    googleAccountId: owner.id
                },
                // But has projects where the user is a member
                projects: {
                    some: {
                        AND: [
                            {
                                id: {
                                    in: memberProjectIds,
                                }
                            },
                            {
                                status: "Normal"
                            }
                        ]
                    }
                }
            },
            include: {
                projects: {
                    where: {
                        OR: [
                            {
                                // Projects where user is a member
                                members: { some: { userId: userId } }
                            },
                            {
                                // Projects where user is the owner
                                ownerId: parseInt(userId.toString())
                            }
                        ],
                        status: "Normal",
                    },
                    include: {
                        members: { select: { user: { select: { photoURL: true } } } },
                        owner: true,
                        team: true,
                    },
                    orderBy: {
                        id: 'asc'
                    }
                },
                googleAccount: true
            }
        })
        console.log("Participating teams:", participating_teams);

        // ========================== Combine and filter results
        const json = [...owned_teams, ...participating_teams];
        const filteredJson = json.filter(team => team.projects.length > 0);
        console.log("Filtered teams (with projects):", filteredJson);

        return ({
            status: 200,
            json: filteredJson
        })
    } catch (error) {
        console.log("Error in getAllTeamsSidebar:", error);
        return ({
            status: 400,
            json: []
        })
    }
};

export default getAllTeamsSidebar;