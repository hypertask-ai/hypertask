import { NextApiRequest, NextApiResponse } from "next";

export default async function NextApiHandler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "POST") {
    try {
      return res.status(200).json({ message: "Success" });
    } catch (error) {
      console.log("🤔 ~ NextApiHandler ~ error:", error);
      return res.status(500).json({ message: error });
    }
  } else return res.status(405).json({ message: "Method not allowed" });
}
