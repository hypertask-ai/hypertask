import prisma from "@/lib/prisma";
import { IProjectMonthly, IProjectWeekly, IProjectDaily } from "@/models/dashboardStatsModel";

import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  // if (req.method === "POST") {
    try {
      const { lastXdays, lastXmonths, lastXweeks } = req.body;
      const response = await getProjectCounts(lastXdays, lastXweeks, lastXmonths)
      console.log("🚀 ~ consthandler:NextApiHandler= ~ response:", response)

      return res.status(200).json({ response })

    } catch (error) {
      console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error)
      return res.status(500)
    }

  // }
}
export default handler


async function getProjectCounts(lastXdays: number = 14, lastXweeks: number = 4, lastXmonths: number = 12) {
  // Monthly aggregation
  const monthlyCounts: IProjectMonthly[] = await prisma.$queryRaw`
      SELECT 
        TO_CHAR("createdAt", 'Month,YYYY') AS month,
        COUNT(*) AS project_count
      FROM 
        "Project"
      WHERE 
        "createdAt" >= NOW() - INTERVAL '1 month' * ${lastXmonths}
        AND "id" != 15
      GROUP BY 
        TO_CHAR("createdAt", 'Month,YYYY')
      ORDER BY 
        TO_DATE(TO_CHAR("createdAt", 'Month,YYYY'), 'Month, YYYY');
    `;


  // Weekly aggregation
  const weeklyCounts: IProjectWeekly[] = await prisma.$queryRaw`
      SELECT 
        EXTRACT(YEAR FROM "createdAt") AS year,
        EXTRACT(WEEK FROM "createdAt") AS week,
        COUNT(*) AS project_count
      FROM 
        "Project"
        WHERE
        "createdAt" >= NOW() - INTERVAL '1 week' * ${lastXweeks}
        AND "id" != 15

      GROUP BY 
        year, week
      ORDER BY 
        year, week;
    `;

  // Daily aggregation
  const dailyCounts: IProjectDaily[] = await prisma.$queryRaw`
          SELECT 
            DATE("createdAt") AS day,
            COUNT(*) AS project_count
          FROM 
            "Project"
            WHERE 
            "createdAt" >= NOW() - INTERVAL '1 day' * ${lastXdays}
            AND "id" != 15

          GROUP BY 
            day
          ORDER BY 
            day;
        `;
  const totalBoards = await prisma.project.count({ where: { status: { not: "Deleted" } } })
  const totalTeams = await prisma.team.count({where:{projects:{none:{id:15}}}})

  return {
    monthlyCounts: monthlyCounts?.map((x) => ({ name: x.month.trim(), total: parseInt(x.project_count) })) ?? [],
    weeklyCounts: weeklyCounts?.map((x) => ({ name: x.week, total: parseInt(x.project_count) })) ?? [],
    dailyCounts: dailyCounts?.map((x) => ({ name: x.day, total: parseInt(x.project_count) })) ?? [],
    totalBoards,
    totalTeams
  };

}
