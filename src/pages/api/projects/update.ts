import { NextApiHandler } from "next";
import updateProject from "@/utils/controllers/projects/update";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });
  const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
  if (!session) return res.status(401).json({ message: "Unauthorized" });
  const currentUser = await loadSessionUserRecord(session.userId);
  try {
    const { projectId, title, sorting_mode, uniqueIdentifier } = req.body;
    const response = await updateProject(projectId, title, sorting_mode, uniqueIdentifier, currentUser);
    return res.status(response.status).json(response.json);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : "Unable to update board" });
  }
};

export default handler;
