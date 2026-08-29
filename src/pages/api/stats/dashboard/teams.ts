// Import PrismaClient from the generated Prisma client
import prisma from '@/lib/prisma';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { json } from "@/utils/helperFunctions/helperFunctions";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method==="GET"){
        
        try {
            // const teams = await prisma.team.findMany({
            //     include:{
            //         googleAccount:{
                        
            //         }
            //     }
            // })
            const result = await prisma.$queryRaw`
            SELECT 
              t.id AS team_id,
              t.title AS team_title,
              t."createdAt" AS team_created_at,
              u."displayName" AS owner_display_name,
              t."totalSeats" AS total_seats,
              JSON_AGG(ta) as team_activity,
            --   u.id AS "userId",
              (SELECT COUNT(*) FROM "Member_Team" mt WHERE mt."teamId" = t.id) + 1 AS member_count_adjusted,
              (SELECT COUNT(*) FROM "Project" p WHERE p."teamId" = t.id AND EXISTS (
                SELECT 1 FROM "Task" tk WHERE tk."projectId" = p.id AND tk."status"!= 'Deleted'
              )) AS project_count,
              (SELECT COUNT(*) FROM "Project" p INNER JOIN "Task" tk ON p.id = tk."projectId" WHERE p."teamId" = t.id AND tk."status"!= 'Deleted') AS task_count,
              (SELECT COUNT(*) FROM "Project" p INNER JOIN "Task" tk ON p.id = tk."projectId" WHERE p."teamId" = t.id AND tk."status"= 'Archive') AS archived_task_count,

              CASE 
                WHEN t."activeSubscriptionPlanId" IS NOT NULL AND t."activeSubscriptionPlanId" <> '' THEN 'Has subscription' 
                ELSE 'No subscription' 
              END AS subscription_status,
              ARRAY_AGG(DISTINCT p.title) AS project_names
            FROM 
              "Team" t
 
            JOIN 
              "GoogleAccount" ga ON t."googleAccountId" = ga.id
            JOIN 
              "User" u ON ga."userId" = u.id AND u.id NOT IN (4,6)
            JOIN 
              "Team_Activity" ta ON ta."teamId" = t.id
            LEFT JOIN 
              "Member_Team" mt ON t.id = mt."teamId"
            LEFT JOIN 
              "Project" p ON t.id = p."teamId"
            GROUP BY 
              t.id, t.title,t."createdAt", u."displayName";
          `;
          
          
            console.log("🚀 ~ consthandler:NextApiHandler= ~ result:", result)
            return res.status(200).send(json(result))

        } catch (error) {
            console.log('Error creating section:', error);
            throw error;
        } 

    }
}


export default handler