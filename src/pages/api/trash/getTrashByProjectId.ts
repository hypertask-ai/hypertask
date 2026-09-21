import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import getTrashByProjectId from '@/utils/controllers/trash/getByProjectId';



async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    const {projectId} = req.query
    const user = JSON.parse(req.cookies.nookies_user!)

    if (!projectId || !user) return res.status(400).json({message:"Missing Required information"})

    const response = await getTrashByProjectId({projectId:parseInt(projectId as string), userId:user.id})
    htLogger.info("🚀 ~ response:", response)
    return res.status(200).json(response)
  } catch (error) {
      htLogger.info(error)
      return res.status(500).json(error)
  }
}

export default withAuth(handler, { authenticateInHandler: true });
