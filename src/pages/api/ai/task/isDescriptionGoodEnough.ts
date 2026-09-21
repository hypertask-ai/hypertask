import prisma from '@/lib/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';

type Data = {
    success: boolean;
    message?: string;
};

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<Data>
) {
    console.log('Received request:', req.method, req.body);

    if (req.method !== 'POST') {
        console.log('Method not allowed:', req.method);
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { flaggedIncomplete, taskId } = req.body;
    console.log('Parsed body:', { flaggedIncomplete, taskId });

    if (typeof flaggedIncomplete !== 'boolean' || !taskId) {
        console.log('Invalid input:', req.body);
        return res.status(400).json({ success: false, message: 'Invalid input' });
    }

    try {
        const result = await prisma.description.updateMany({
            where: { taskId },
            data: { flaggedIncomplete },
        });
        console.log('Database update result:', result);

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Database error:', error);
        return res.status(500).json({ success: false, message: 'Database error' });
    }
}