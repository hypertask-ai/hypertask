import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
// id:`notifications-for-task-${taskId}`


import type { NextApiRequest, NextApiResponse } from 'next'
import invokeReminder from '@/utils/controllers/reminders/invokeReminder';



async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    
    const {reminder} = req.body
    htLogger.info("🚀 ~ userId:", reminder)

    if (!reminder) return res.status(400).json({message:"Missing required information"})
    
    await invokeReminder(reminder)
    

    
    htLogger.info("🚀 ~ reminders:", reminder)
    return res.status(200).json(reminder)
  } catch (error) {
      htLogger.info(error)
      return res.status(500).json(error)
  }
}

export default withAuth(handler, { authenticateInHandler: true });
