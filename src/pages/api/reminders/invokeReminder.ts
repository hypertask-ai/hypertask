// id:`notifications-for-task-${taskId}`


import type { NextApiRequest, NextApiResponse } from 'next'
import invokeReminder from '@/utils/controllers/reminders/invokeReminder';



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    
    const {reminder} = req.body
    console.log("🚀 ~ userId:", reminder)

    if (!reminder) return res.status(400).json({message:"Missing required information"})
    
    await invokeReminder(reminder)
    

    
    console.log("🚀 ~ reminders:", reminder)
    return res.status(200).json(reminder)
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
