// Import PrismaClient from the generated Prisma client
import prisma from '@/lib/prisma';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
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
