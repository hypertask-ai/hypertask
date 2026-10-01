// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
// "/api/activity/addLastActiveAt"
import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { hasTeamMembershipAccess } from "@/utils/controllers/teams/hasTeamMembershipAccess";

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
    if (req.method !== "POST") {
        return res.status(405).json({ message: "Method not allowed" });
    }
    try {
        const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
        if (!session) return res.status(401).json({ message: "Unauthorized" });
        const { userId: bodyUserId, teamId } = req.body;

        if (bodyUserId != null && Number(bodyUserId) !== session.userId) {
            return res.status(403).json({ message: "Forbidden" });
        }
        if (bodyUserId == null && !teamId) {
            return res.status(400).json({ message: "Missing required information" });
        }
        if (teamId && !(await hasTeamMembershipAccess(session.userId, String(teamId)))) {
            return res.status(403).json({ message: "Forbidden" });
        }

        const response = await updateActivity({
            userId: bodyUserId != null || !teamId ? session.userId : undefined,
            teamId: teamId ? String(teamId) : undefined,
        });
        res.status(200).json(response);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error", error: error });
    }
}