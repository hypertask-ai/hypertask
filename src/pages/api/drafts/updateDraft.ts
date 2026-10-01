// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import prisma from '@/lib/prisma'
import type { NextApiRequest, NextApiResponse } from 'next'
import { getSessionUser } from "@/lib/auth/getSessionUser";

export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    if (req.method!=="POST") return
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;
    const {content, taskId, type, projectId} = req.body
    if (!content || !taskId || !type ) return res.status(400).json({message:"Missing Required Information"})

    // A canceled browser autosave can still finish on the server while the next
    // request starts. The old find-then-create sequence let both requests see
    // no row and race on the unique (taskId, type, userId) key.
    const draft = await prisma.drafts.upsert({
      where: {
        taskId_type_userId: {
          taskId,
          type,
          userId,
        },
      },
      create: {
        userId,
        taskId,
        type,
        projectId,
        saved: false,
        content,
      },
      update: {
        projectId,
        saved: false,
        content,
      },
    })

    return res.status(200).json(draft)

  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
