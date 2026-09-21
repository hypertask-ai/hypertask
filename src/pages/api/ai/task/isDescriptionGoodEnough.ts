import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
import prisma from '@/lib/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';

type Data = {
    success: boolean;
    message?: string;
};

async function handler(
    req: NextApiRequest,
    res: NextApiResponse<Data>
) {
    htLogger.info('Received request:', req.method, req.body);

    if (req.method !== 'POST') {
        htLogger.info('Method not allowed:', req.method);
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { flaggedIncomplete, taskId } = req.body;
    htLogger.info('Parsed body:', { flaggedIncomplete, taskId });

    if (typeof flaggedIncomplete !== 'boolean' || !taskId) {
        htLogger.info('Invalid input:', req.body);
        return res.status(400).json({ success: false, message: 'Invalid input' });
    }

    try {
        const result = await prisma.description.updateMany({
            where: { taskId },
            data: { flaggedIncomplete },
        });
        htLogger.info('Database update result:', result);

        return res.status(200).json({ success: true });
    } catch (error) {
        htLogger.error('Database error:', error);
        return res.status(500).json({ success: false, message: 'Database error' });
    }
}

export default withAuth(handler);
