import prisma from '@/lib/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const adminPassword = process.env.ADMIN_USER_RESET_PW;
    if (!adminPassword || req.headers['x-admin-password'] !== adminPassword) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { emails } = req.body;

    if (!emails || !Array.isArray(emails) || emails.some(e => typeof e !== 'string')) {
        return res.status(400).json({ error: 'Invalid emails array' });
    }

    try {
        const users = await prisma.user.findMany({
            where: {
                email: {
                    in: emails
                }
            }
        });
        res.status(200).json({ users });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
}
