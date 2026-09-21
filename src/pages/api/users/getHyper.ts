import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
import { NextApiHandler } from "next";
import { getHyperUser } from "@/utils/controllers/users/getHyper";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const user = await getHyperUser();
    if (!user) {
      return res.status(400).json({ message: "Unable to find HyperAI from DB" });
    }
    return res.status(200).json(user);
  } catch (error) {
    htLogger.info(error);
    return res.status(400).json({ message: "Unable to find HyperAI from DB" });
  }
};

export default withAuth(handler);
