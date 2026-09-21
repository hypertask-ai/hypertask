import prisma from "@/lib/prisma";
import { ICommentWeekly, ICommentDaily, ICommentMonthly } from "@/models/dashboardStatsModel";



import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  // if (req.method === "POST") {
    try {
      const { lastXdays, lastXmonths, lastXweeks } = req.body;
      const response = await getTaskCounts(lastXdays, lastXweeks, lastXmonths)
      console.log("🚀 ~ consthandler:NextApiHandler= ~ response:", response)

      return res.status(200).json({ response })

    } catch (error) {
      console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error)
      return res.status(500)
    }

  // }
}
export default handler;


async function getTaskCounts(lastXdays: number = 7, lastXweeks: number = 4, lastXmonths: number = 12) {
  // Monthly aggregation
  const monthlyCounts: ICommentMonthly[] = await prisma.$queryRaw`
    SELECT 
      TO_CHAR(c."createdAt", 'Month,YYYY') AS month,
      COUNT(*) AS comment_count
    FROM 
      "Comment" c
    JOIN 
      "Task" t ON c."taskId" = t."id"
    WHERE 
      c."createdAt" >= NOW() - INTERVAL '1 month' * ${lastXmonths}
      AND t."projectId" != 15
    GROUP BY 
      TO_CHAR(c."createdAt", 'Month,YYYY')
    ORDER BY 
      TO_DATE(TO_CHAR(c."createdAt", 'Month,YYYY'), 'Month, YYYY');
  `;

  // Weekly aggregation
  const weeklyCounts: ICommentWeekly[] = await prisma.$queryRaw`
    SELECT 
      EXTRACT(YEAR FROM c."createdAt") AS year,
      EXTRACT(WEEK FROM c."createdAt") AS week,
      COUNT(*) AS comment_count
    FROM 
      "Comment" c
    JOIN 
      "Task" t ON c."taskId" = t."id"
    WHERE
      c."createdAt" >= NOW() - INTERVAL '1 week' * ${lastXweeks}
      AND t."projectId" != 15
    GROUP BY 
      year, week
    ORDER BY 
      year, week;
  `;

  // Daily aggregation
  const dailyCounts: ICommentDaily[] = await prisma.$queryRaw`
    SELECT 
      DATE(c."createdAt") AS day,
      COUNT(*) AS comment_count
    FROM 
      "Comment" c
    JOIN 
      "Task" t ON c."taskId" = t."id"
    WHERE 
      c."createdAt" >= NOW() - INTERVAL '1 day' * ${lastXdays}
      AND t."projectId" != 15
    GROUP BY 
      day
    ORDER BY 
      day;
  `;

  const totalCommentsOverall = await prisma.comment.count({where:{task:{projectId:{not:15}}}})
  return {
    monthlyCounts: monthlyCounts?.map((x) => ({ name: x.month.trim(), total: parseInt(x.comment_count) })) ?? [],
    weeklyCounts: weeklyCounts?.map((x) => ({ name: x.week, total: parseInt(x.comment_count) })) ?? [],
    dailyCounts: dailyCounts?.map((x) => ({ name: x.day, total: parseInt(x.comment_count) })) ?? [],
    totalCommentsOverall
  };
}
