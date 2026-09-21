import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import { getSessionUser } from "@/lib/auth/getSessionUser";
import notificationGetByTask from "@/utils/controllers/notifications/getByTask";

// HTPR-4465: this route used to take `userId` from the request body and pass it
// straight to an updateMany({ seen: true }), so any logged-in user could mark
// another user's notifications as read. Since the unread-aware email digest
// shipped, `seen` also decides whether their notification email goes out, so it
// silenced their emails too. Identity now comes from the session and the body
// value is ignored. The only caller already sent its own id, so nothing changes
// for legitimate use.
//
// The GET branch went with it: nothing called it, it ran a findMany whose result
// was discarded, and it never sent a response at all.
const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>),
    );
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    const { taskId } = req.body;
    if (!taskId) {
      return res.status(400).json({ message: "Task id is required" });
    }

    const response = await notificationGetByTask(session.userId, taskId);
    return res.status(response.status).json(response.json);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
