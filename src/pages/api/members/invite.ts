import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import membersInvite from "@/utils/controllers/members/invite";
import { GUEST_FORBIDDEN_MESSAGE, isGuestRequest } from "@/lib/demo/guestGuard";
import { getSessionUser } from "@/lib/auth/getSessionUser";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        try {
            if (await isGuestRequest(req)) {
                return res.status(403).json({ message: GUEST_FORBIDDEN_MESSAGE });
            }
            const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
            if (!session) {
                return res.status(401).json({ message: "Unauthorized" });
            }
            const { projectId, inviteKey } = req.body;
            if (!inviteKey) {
                return res.status(400).json({ message: "Missing required information" });
            }

            const response = await membersInvite(session.userId, projectId, inviteKey )
            return res.status(response.status === 403 ? 403 : 200).json(response.json);
        } catch (error) {
            console.log(error);
            return res.status(400).json({ message: JSON.stringify(error) });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;
