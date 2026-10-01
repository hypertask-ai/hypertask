import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { addAgentToBoard } from "@/utils/controllers/agents/boardMembers";
import { GUEST_FORBIDDEN_MESSAGE, isGuestRequest } from "@/lib/demo/guestGuard";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const userId = session.userId;

  try {
    if (await isGuestRequest(req)) {
      return res.status(403).json({ message: GUEST_FORBIDDEN_MESSAGE });
    }

    const { projectId, agentId } = req.body;
    if (!projectId || !agentId) {
      return res.status(400).json({ message: "Missing required information" });
    }

    const result = await addAgentToBoard(
      parseInt(String(projectId), 10),
      String(agentId),
      userId
    );

    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    return res.status(200).json({
      message: "Success",
      member: result.member,
      agent: result.member.agent,
    });
  } catch (error) {
    console.error("[addAgent] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
