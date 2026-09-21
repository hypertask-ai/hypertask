import { getAuthSession, withAuth } from "#with-auth";
import type { NextApiRequest, NextApiResponse } from "next";
import getProjectsLastActivity from "@/utils/controllers/projects/lastActivity";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }
  // Identity comes from the verified session, never from a client-readable
  // cookie: this returns which boards an account can see and when each last
  // moved, so a spoofable id would leak that across accounts.
  const session = await getAuthSession(
    new Headers(req.headers as Record<string, string>),
  );
  if (!session) return res.status(401).json({ message: "Unauthorized" });

  const response = await getProjectsLastActivity(session.userId);
  return res.status(response.status).json(response.json);
};

export default withAuth(handler, { authenticateInHandler: true });
