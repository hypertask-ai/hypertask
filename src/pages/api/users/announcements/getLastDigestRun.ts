import { logDesktopCliResponse } from "@/lib/auth/desktopCliTokenUser";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import { getSessionUser } from "@/lib/auth/getSessionUser";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_9064_LATEST_UPDATES_WEEK_FLAG } from "@/lib/flags/definitions/htpr-9064-latest-updates-week";
import { lastDigestRunAt } from "@/lib/rocketDigest/lastRun";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
  logDesktopCliResponse(session, req, res);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
  }

  if (!(await isFeatureEnabled(HTPR_9064_LATEST_UPDATES_WEEK_FLAG, session.userId))) {
    return res.status(200).json({ lastRunAt: null });
  }

  try {
    const lastRunAt = await lastDigestRunAt();
    return res.status(200).json({ lastRunAt: lastRunAt?.toISOString() ?? null });
  } catch (error) {
    console.log(error);
    return res.status(200).json({ lastRunAt: null });
  }
};

export default handler;
