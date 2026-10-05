import getUserDrafts from "@/utils/controllers/drafts/getUserDrafts";
import type { NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const userId = session.userId;

  try {
    return res.status(200).json(await getUserDrafts(userId));
  } catch (error) {
    console.log(error);
    return res.status(500).json(error);
  }
}
