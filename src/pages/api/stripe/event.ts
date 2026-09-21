import { logger as htLogger } from "#logger";
import { withoutAuth } from "#with-auth";
import { NextApiRequest, NextApiResponse } from "next";

async function NextApiHandler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "POST") {
    try {
      return res.status(200).json({ message: "Success" });
    } catch (error) {
      htLogger.info("🤔 ~ NextApiHandler ~ error:", error);
      return res.status(500).json({ message: error });
    }
  } else return res.status(405).json({ message: "Method not allowed" });
}

export default withoutAuth(NextApiHandler);
