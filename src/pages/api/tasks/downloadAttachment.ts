import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import { NextApiRequest, NextApiResponse } from "next";
import { getAccessibleAttachmentKey } from "@/utils/controllers/tasks/getAccessibleAttachmentKey";

import {
  getHypertasksS3Client,
  HYPERTASKS_S3_BUCKET,
} from "@/lib/storage/hypertasksS3";
import { getSessionUser } from "@/lib/auth/getSessionUser";

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }
  if (req.method === "GET") {
    const userId = session.userId;

    const s3 = getHypertasksS3Client();
    const { fileName, fileSource } = req.query;

    if (!fileSource || !fileName) {
      res.status(400).send("File name is required");
      return;
    }

    try {
      const fileSourceStr = fileSource.toString();

      const key = await getAccessibleAttachmentKey(fileSourceStr, userId);
      if (!key) {
        res.status(404).send("File not found");
        return;
      }

      const params = {
        Bucket: HYPERTASKS_S3_BUCKET,
        Key: key,
        Expires: 60, // URL expiration in seconds
        ResponseContentDisposition: `attachment; filename=${encodeURIComponent(fileName.toString())}`,
      };

      const downloadUrl = s3.getSignedUrl("getObject", params);

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache"); // For compatibility with older browsers
      res.setHeader("Expires", "0");

      res.status(200).json({ downloadUrl });
    } catch (err) {
      console.error("Error fetching file from S3:", err);
      res.status(500).send("Error fetching file");
    }
  }
}

export default withTaskWriteFlag(handler, "GET", async () =>
  (await import("@/lib/api/task-writes/download-attachment")).GET,
);
