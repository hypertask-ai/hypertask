import { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

import {
  getHypertasksS3Client,
  HYPERTASKS_S3_BUCKET,
  parseHypertasksStorageKeyFromUrl,
} from "@/lib/storage/hypertasksS3";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "GET") {
    const userObj = req.cookies?.nookies_user
      ? JSON.parse(req.cookies.nookies_user)
      : null;
    if (!userObj || !userObj.id) {
      res.status(401).send("Unauthorized");
      return;
    }

    const s3 = getHypertasksS3Client();
    const { fileName, fileSource } = req.query;

    if (!fileSource || !fileName) {
      res.status(400).send("File name is required");
      return;
    }

    try {
      const fileSourceStr = fileSource.toString();

      // Look up the attachment record to verify project membership
      const attachment = await prisma.attachment.findFirst({
        where: { fileSource: fileSourceStr },
        select: {
          task: { select: { projectId: true } },
          description: { select: { task: { select: { projectId: true } } } },
          comment: { select: { task: { select: { projectId: true } } } },
          chatMessage: { select: { session: { select: { userId: true } } } },
        },
      });

      if (attachment) {
        // Determine the projectId through whichever relation is populated
        const projectId =
          attachment.task?.projectId ??
          attachment.description?.task?.projectId ??
          attachment.comment?.task?.projectId;

        if (attachment.chatMessage) {
          // Chat message attachment: only the session owner may download
          if (attachment.chatMessage.session.userId !== userObj.id) {
            res.status(403).send("Forbidden");
            return;
          }
        } else if (projectId != null) {
          // Task/description/comment attachment: verify project membership
          const project = await prisma.project.findFirst({
            where: {
              id: projectId,
              OR: [
                { members: { some: { userId: userObj.id } } },
                { ownerId: userObj.id },
              ],
            },
            select: { id: true },
          });
          if (!project) {
            res.status(403).send("Forbidden");
            return;
          }
        }
        // If attachment exists but has no resolvable project/chatMessage (e.g. AI_Custom_Instructions),
        // allow authenticated users through
      }
      // If no attachment record found, allow authenticated users (legacy files)

      const key = getKey(fileSourceStr);
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

const getKey = (url: string) => {
  const key = parseHypertasksStorageKeyFromUrl(url);
  if (!key) {
    throw "unknown link";
  }
  return key;
};
