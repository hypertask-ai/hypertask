import setMemberRole from "@/utils/controllers/projects/setMemberRole";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === "POST") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;
    try {
      const { projectId, targetUserId, role } = req.body;
      const response = await setMemberRole(
        userId,
        projectId,
        targetUserId,
        role,
      );
      return res.status(response.status).json(response.json);
    } catch (error) {
      console.error(error);
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
