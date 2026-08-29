// Import PrismaClient from the generated Prisma client
import { IUrl } from '@/models/model';
import addIntoTask from '@/utils/controllers/urls/addIntoTask';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
// Create an instance of PrismaClient

// Example usage
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const { urlsToAdd,commentId}:{urlsToAdd:IUrl[], commentId:number} = req.body;
    if (!urlsToAdd || !commentId) return res.status(300).json({message:"Missing Required Data"})
    
    const response = await addIntoTask(urlsToAdd,commentId, req.method)
    return res.status(response?.status).json(response?.json)
  } 
  
  catch (error) {
    console.log(error)
    return res.status(500).json({message:"Something went wrong", error:error})
  }

}

// Run the main function
export default handler;