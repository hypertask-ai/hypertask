import { env as appEnv } from "#env";
import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
// Import PrismaClient from the generated Prisma client
import prisma from '@/lib/prisma';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method==="GET"){
        const { password } = req.query;
        if (!password || password !==appEnv.ANALYTICS_PASSWORD) return res.status(404).json({ message: "Missing Required Data pr incorrect password" });
        try {

            // getTaskCounts().then(result => {
            //     debug.log('Monthly Counts:', result.monthlyCounts);
            //     debug.log('Weekly Counts:', result.weeklyCounts);
            //     debug.log('Daily Counts:', result.dailyCounts);
            //     debug.log("total count", result.totalTasksOverall)
            //   }).catch(error => {
            //     debug.error(error);
            //   })
        } catch (error) {
            htLogger.info('Error creating section:', error);
            throw error;
        }

    }
}


export default withAuth(handler, { authenticateInHandler: true })
