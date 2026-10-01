import { NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";

export default async function NextApiHandler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "POST") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      return res.status(200).json({ message: "Success" });
    } catch (error) {
      console.log("🤔 ~ NextApiHandler ~ error:", error);
      return res.status(500).json({ message: error });
    }
  } else return res.status(405).json({ message: "Method not allowed" });
}
