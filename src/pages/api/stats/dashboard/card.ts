// Import PrismaClient from the generated Prisma client
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
    if (!session) return res.status(401).json({ message: "Unauthorized" });
    const adminPassword = process.env.ADMIN_USER_RESET_PW;
    if (!adminPassword || req.headers["x-admin-password"] !== adminPassword) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (req.method==="GET"){
        const { password } = req.query;
        if (!password || password !==process.env.ANALYTICS_PASSWORD) return res.status(404).json({ message: "Missing Required Data pr incorrect password" });
        try {
         
            // getTaskCounts().then(result => {
            //     console.log('Monthly Counts:', result.monthlyCounts);
            //     console.log('Weekly Counts:', result.weeklyCounts);
            //     console.log('Daily Counts:', result.dailyCounts);
            //     console.log("total count", result.totalTasksOverall) 
            //   }).catch(error => {
            //     console.error(error);
            //   })
        } catch (error) {
            console.log('Error creating section:', error);
            throw error;
        } 

    }
}


export default handler
