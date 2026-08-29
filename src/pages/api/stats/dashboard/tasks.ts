import prisma from "@/lib/prisma";
import { ITaskMonthly, ITaskDaily, ITaskWeekly } from "@/models/dashboardStatsModel";

import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      const { lastXdays, lastXmonths, lastXweeks } = req.body;
      const response = await getTaskCounts(lastXdays, lastXweeks, lastXmonths)
      console.log("🚀 ~ consthandler:NextApiHandler= ~ response:", response)

      return res.status(200).json({ response })

    } catch (error) {
      console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error)
      return res.status(500)
    }

  
}
export default handler
async function getTaskCounts(lastXdays: number = 7, lastXweeks: number = 4, lastXmonths: number = 12) {
  // Monthly aggregation
  const monthlyCounts: ITaskMonthly[] = await prisma.$queryRaw`
      SELECT 
        TO_CHAR("createdAt", 'Month,YYYY') AS month,
        COUNT(*) AS task_count
      FROM 
        "Task"
      WHERE 
        "createdAt" >= NOW() - INTERVAL '1 month' * ${lastXmonths}
        AND "projectId" != 15

      GROUP BY 
        TO_CHAR("createdAt", 'Month,YYYY')
      ORDER BY 
        TO_DATE(TO_CHAR("createdAt", 'Month,YYYY'), 'Month, YYYY');
    `;


  // Weekly aggregation
  const weeklyCounts: ITaskWeekly[] = await prisma.$queryRaw`
      SELECT 
        EXTRACT(YEAR FROM "createdAt") AS year,
        EXTRACT(WEEK FROM "createdAt") AS week,
        COUNT(*) AS task_count
      FROM 
        "Task"
    WHERE 
        "createdAt" >= NOW() - INTERVAL '1 week' * ${lastXweeks}
        AND "projectId" != 15

      GROUP BY 
        year, week
      ORDER BY 
        year, week;
    `;
  console.log("🚀 ~ getTaskCounts ~ weeklyCounts:", weeklyCounts)

  const dailyCounts: ITaskDaily[] = await prisma.$queryRaw`
          SELECT 
            DATE("createdAt") AS day,
            COUNT(*) AS task_count
          FROM 
            "Task"
            WHERE 
            "createdAt" >= NOW() - INTERVAL '1 day' * ${lastXdays}
            AND "projectId" != 15

          GROUP BY 
            day
          ORDER BY 
            day;
        `;
  const totalActiveTasksOverall = await prisma.task.count({ where: { status: "Normal", projectId:{not:15} } })
  const totalCompletedTasksOverall = await prisma.task.count({ where: { status: "Archive",projectId:{not:15} } })

  return {
    monthlyCounts: monthlyCounts?.map((x) => ({ name: x.month.trim(), total: parseInt(x.task_count) })) ?? [],
    weeklyCounts: weeklyCounts?.map((x) => ({ name: x.week, total: parseInt(x.task_count) })) ?? [],
    dailyCounts: dailyCounts?.map((x) => ({ name: x.day, total: parseInt(x.task_count) })) ?? [],
    totalActiveTasksOverall,
    totalCompletedTasksOverall
  };
}
