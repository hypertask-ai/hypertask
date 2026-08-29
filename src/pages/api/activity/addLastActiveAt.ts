// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
// "/api/activity/addLastActiveAt"
import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";

async function updateActivity({ userId, teamId }: { userId?: number; teamId?: string }) {
    if (!userId && !teamId) {
        throw new Error("Missing required information");
    }

    if (userId) {
        return await prisma.user_Activity.update({
            where: { userId },
            data: { lastActiveAt: new Date() },
        });
    }

    if (teamId) {
        return await prisma.team_Activity.update({
            where: { teamId },
            data: { lastActiviyAt: new Date() },
        });
    }
}


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        const { userId, teamId } = req.body;

        if (!userId && !teamId) {
            return res.status(400).json({ message: "Missing required information" });
        }

        const response = await updateActivity({ userId, teamId });
        res.status(200).json(response);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error", error: error });
    }
}