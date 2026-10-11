import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import { NextApiHandler } from "next";
import create from "@/utils/controllers/projects/create";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }
  const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
  if (!session) return res.status(401).json({ message: "Unauthorized" });
  try {
    const { title, teamId, googleAccountId, ticketPrefix } = req.body;
    const response = await create(session.userId, title, teamId, googleAccountId, ticketPrefix);
    return res.status(response.status).json(response.json);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : "Unable to create board" });
  }
};

export default withTaskWriteFlag(handler, "POST", async () =>
  (await import("@/lib/api/project-writes/create")).POST,
);
