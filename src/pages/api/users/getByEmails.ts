import prisma from '@/lib/prisma';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * API route handler for fetching users by their email addresses.
 *
 * Accepts a POST request with a JSON body containing an array of email strings.
 * Returns a list of user objects whose emails match any in the provided array.
 *
 * @param req - The Next.js API request object.
 * @param res - The Next.js API response object.
 *
 * @remarks
 * - Only POST requests are allowed. Other methods will return a 405 error.
 * - The request body must include an `emails` property, which should be an array of strings.
 * - Returns a 400 error if the emails array is missing or invalid.
 * - Returns a 500 error if there is an internal server error during the database query.
 *
 * @example
 * // Example POST request body:
 * {
 *   "emails": ["user1@example.com", "user2@example.com"]
 * }
 *
 * // Example response:
 * {
 *   "users": [
 *     { "id": 1, "email": "user1@example.com", ... },
 *     { "id": 2, "email": "user2@example.com", ... }
 *   ]
 * }
 */
export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // HTPR-4808: /reset admin tool only. This returns whole User rows
    // (stripe_customer_id, uid, accountId...) for any email handed to it, so
    // accepting any signed-in session would hand every account to a fresh trial
    // signup. Same gate as resetUser and reset-trial.
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
