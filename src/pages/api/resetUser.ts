import prisma from '@/lib/prisma'
import { resetUserAccount } from '@/utils/controllers/users/resetUserAccount';
import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: "Method not allowed" });
    }

    const adminPassword = process.env.ADMIN_USER_RESET_PW;
    if (!adminPassword || req.headers['x-admin-password'] !== adminPassword) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    const { userToResetId, newOwnerId } = req.body;
    if (!userToResetId || !newOwnerId) {
        return res.status(400).json({ message: "Missing required parameters" });
    }

    const response = await resetUserAccount(userToResetId, newOwnerId);
    return res.status(response.status).json(response.json);
}

const validateTransfer = async (userToResetId: number, newOwnerId: number) => {
    const issues = [];

    const [userToReset, newOwner] = await Promise.all([
        prisma.user.findUnique({ where: { id: userToResetId } }),
        prisma.user.findUnique({ where: { id: newOwnerId } })
    ]);

    if (!userToReset) issues.push("User to reset not found");
    if (!newOwner) issues.push("New owner not found");
    if (userToResetId === newOwnerId) issues.push("Cannot transfer to same user");

    const [projectCount, teamCount] = await Promise.all([
        prisma.project.count({ where: { ownerId: userToResetId } }),
        prisma.team.count({ where: { googleAccount: { userId: userToResetId } } })
    ]);

    return {
        valid: issues.length === 0,
        issues,
        summary: {
            projectsToTransfer: projectCount,
            teamsToTransfer: teamCount
        }
    };
};

export { validateTransfer };
