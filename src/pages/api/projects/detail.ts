import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import projectDetail from "@/utils/controllers/projects/detail";

import { parseCookies } from "better-auth/cookies";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from "@/lib/flags";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        try {
            const headers = new Headers(req.headers as Record<string, string>);
            const sessionUser = await getSessionUser(headers);
            if (!sessionUser) return res.status(401).json({ message: "Unauthorized" });
            const cookieHeader = headers.get("cookie");
            const signed = verifySession(cookieHeader ? parseCookies(cookieHeader).get(SESSION_COOKIE) : undefined);
            const agentId = signed?.id === sessionUser.userId ? signed.agentId : undefined;
            if (req.query?.compat === "htpr-6924") {
                let retired = false;
                try {
                    retired = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, sessionUser.userId);
                } catch {
                }
                if (retired) {
                    return res.status(410).json({
                        error: "Legacy project detail has been retired",
                        replacement: "/api/projects/boardTasks"
                    });
                }
            }
            const { projectId } = req.body;
            const response = await projectDetail(projectId, sessionUser.userId, agentId)
            return res.status(response.status).json(response.json)
        } catch (error) {
            console.log(error);
            return res.status(400).json({ message: JSON.stringify(error) });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;