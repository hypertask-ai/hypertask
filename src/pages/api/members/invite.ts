import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import membersInvite from "@/utils/controllers/members/invite";
import { GUEST_FORBIDDEN_MESSAGE, isGuestRequest } from "@/lib/demo/guestGuard";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        try {
            // HTPR-4303: demo guests can't invite or join real projects.
            if (await isGuestRequest(req)) {
                return res.status(403).json({ message: GUEST_FORBIDDEN_MESSAGE });
            }
            const { userId, projectId, inviteKey } = req.body;
            if (!userId || !inviteKey) {
                return res.status(400).json({ message: "Missing required information" });
            }

            const response = await membersInvite(userId, projectId, inviteKey )
            return res.status(200).json(response.json);
        } catch (error) {
            console.log(error);
            return res.status(400).json({ message: JSON.stringify(error) });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;