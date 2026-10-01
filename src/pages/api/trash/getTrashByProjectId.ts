// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import getTrashByProjectId from '@/utils/controllers/trash/getByProjectId';
import { getSessionUser } from "@/lib/auth/getSessionUser";



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;
    const {projectId} = req.query

    if (!projectId) return res.status(400).json({message:"Missing Required information"})

    const response = await getTrashByProjectId({projectId:parseInt(projectId as string), userId})
    console.log("🚀 ~ response:", response)
    return res.status(200).json(response)
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
