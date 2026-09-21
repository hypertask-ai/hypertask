import prisma from "@/lib/prisma";
import { json } from "@/utils/helperFunctions/helperFunctions";

import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    // 

    try {
        // const allowedModes=["only66loop", "onlyVazcoOrVetsak", "excludeSpecificDomains", "activeNotInSpecificDomains"]
        const { mode } = req.query; // This comes from your request query, e.g., mode=only66loop
        console.log("🚀 ~ consthandler:NextApiHandler= ~ mode:", mode)

        // if (allowedModes.some(x=>(x!==mode))){
        //     return res.status(104).json({message:"Please send a valid mode."})
        // }
        let whereConditions = {};
        
        // // Mode 1: Only users from 66loop.com
        // if (mode === 'only66loop') {
        //     whereConditions = {
        //         email: {
        //             endsWith: "66loop.com"
        //         }
        //     };
        // }
        
        // // Mode 2: Only emails ending with vazco.eu or vetsak.com
        // else if (mode === 'onlyVazcoOrVetsak') {
        //     whereConditions = {
        //         OR: [
        //             {
        //                 email: {
        //                     endsWith: "vazco.eu"
        //                 }
        //             },
        //             {
        //                 email: {
        //                     endsWith: "vetsak.com"
        //                 }
        //             }
        //         ]
        //     };
        // }
        
        // // Mode 3: All emails except the 3 specific domains
        // else if (mode === 'excludeSpecificDomains') {
        //     whereConditions = {
        //         AND: [
        //             {
        //                 email: {
        //                     not: {
        //                         endsWith: "66loop.com"
        //                     }
        //                 }
        //             },
        //             {
        //                 email: {
        //                     not: {
        //                         endsWith: "vazco.eu"
        //                     }
        //                 }
        //             },
        //             {
        //                 email: {
        //                     not: {
        //                         endsWith: "vetsak.com"
        //                     }
        //                 }
        //             }
        //         ]
        //     };
        // }
        
        // // Mode 4: Active users in the last 14 days who are not in the above 3 domains
        // else if (mode === 'activeNotInSpecificDomains') {
        //     whereConditions = {
        //         user_activity: {
        //             lastActiveAt: {
        //                 gte: new Date(new Date().setDate(new Date().getDate() - 14)).toISOString()
        //             }
        //         },
        //         AND: [
        //             {
        //                 email: {
        //                     not: {
        //                         endsWith: "66loop.com"
        //                     }
        //                 }
        //             },
        //             {
        //                 email: {
        //                     not: {
        //                         endsWith: "vazco.eu"
        //                     }
        //                 }
        //             },
        //             {
        //                 email: {
        //                     not: {
        //                         endsWith: "vetsak.com"
        //                     }
        //                 }
        //             }
        //         ]
        //     };
        // }
        
        // Prisma query
        const usersAll = await prisma.user.findMany({
            where: {
                AND: [
                    {
                        email: {
                            not: {
                                endsWith: "66loop.com"
                            }
                        }
                    },
                    {
                        email: {
                            not: {
                                endsWith: "vazco.eu"
                            }
                        }
                    },
                    {
                        email: {
                            not: {
                                endsWith: "vetsak.com"
                            }
                        }
                    }
                ]
            },
            select: {
                displayName: true,
                email: true,
                joinedAt: true,
                user_activity: {},
                _count: {
                    select: {
                        tasks: { where: { status: { not: "Deleted" } } },
                        comments: { where: { task: { status: { not: "Deleted" } } } },
                        assignees: { where: { task: { status: "Archive" } } },
                        projects: { where: { status: { not: "Deleted" } } },
                        members: { where: { project: { status: { not: "Deleted" } } } },
                        
                    }
                }
            }
        });
        
        console.log("🚀 ~ consthandler:NextApiHandler= ~ usersAll:", usersAll[0])
       
//     const usersAll = await prisma.$queryRaw`
//     SELECT 
//         u.id,  
//         u."displayName",
//         u."email",
//         COUNT(DISTINCT t.id) AS "Tasks created",
//         COUNT(DISTINCT c.id) AS "Comments",
//         -- COUNT(DISTINCT a_assigned."taskId") AS "Tasks Assigned TO someone",
//         -- COUNT(DISTINCT a_assignee."taskId") AS "Tasks Assigned BY someeone", -- Corrected column name
//         -- COUNT(DISTINCT a_assignee."taskId") FILTER (WHERE ta.status = 'Archive') AS "Completed Tasks", -- Corrected column name
//         COUNT(DISTINCT p.id) AS "Boards created",
//         COUNT(DISTINCT m.id) AS "Boards joined"
//         FROM 
//             "User" u
//         LEFT JOIN
//             "Task" t ON u.id = t."userId"
//         LEFT JOIN
//             "Comment" c ON u.id = c."creatorId"
//         -- LEFT JOIN
//         --     "Assignees" a_assigned ON u.id = a_assigned."assignerId"
//         -- LEFT JOIN
//         --     "Assignees" a_assignee ON u.id = a_assignee."userId"
//         -- LEFT JOIN
//         --     "Task" ta ON a_assignee."taskId" = ta.id -- Joining Task again to filter by status in the Completed Tasks count
//         LEFT JOIN
//             "Project" p ON u.id = p."ownerId"
//         LEFT JOIN
//             "Member" m ON u.id = m."userId"
//         WHERE 
//             u.email NOT IN ('aalian.2241@gmail.com', 'valentin.yeo@gmail.com')
//         GROUP BY 
//             u.id;    
//   `;


      return res.status(200).json(usersAll)
    } catch (error) {
      console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error)
      return res.status(500)
    }

  
}
export default handler