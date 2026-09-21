import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'
import getDraftsController from '@/utils/controllers/drafts/getDraftsController';



async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
    
  try {
    if (req.method!=="POST")return
    const {taskId, userId} = req.body;
    if (!taskId || !userId) return res.status(400).json({message:"Missing TaskId"})

    const drafts = await getDraftsController(taskId, userId)    
    // debug.log("🚀 ~ drafts:", drafts)
    return res.status(200).json(drafts)
    
  } catch (error) {
      htLogger.info(error)
      return res.status(500).json(error)
  }
}

export default withAuth(handler, { authenticateInHandler: true });
