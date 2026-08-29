import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { removeAgentFromBoard } from "@/utils/controllers/agents/boardMembers";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { projectId, agentId } = req.body;
    if (!projectId || !agentId) {
      return res.status(400).json({ message: "Missing required information" });
    }

    const currentUser = JSON.parse(req.cookies.nookies_user!);
    const result = await removeAgentFromBoard(
      parseInt(String(projectId), 10),
      String(agentId),
      currentUser.id
    );

    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    return res.status(200).json({ message: "Success" });
  } catch (error) {
    console.error("[removeAgent] Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
