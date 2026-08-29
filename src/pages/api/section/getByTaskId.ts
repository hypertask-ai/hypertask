// Import PrismaClient from the generated Prisma client
import sectionGetByTask from '@/utils/controllers/section/getByTask';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

// Create an instance of PrismaClient

// Example usage
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
if (req.method==="POST"){

    const { taskId } = req.body;
    if (!taskId) {
      return res.status(400).json({ message: "Missing TaskId" });
  }
  try {
    // Get all sections
    // const sections = await prisma.section.findMany({
    //     where:{
    //         projectId:projectId,
    //         deleted:false,
    //     },
    //     orderBy:{
    //       ranking:"asc"
    //     }

    // });
    const response = await sectionGetByTask( taskId)
    return res.status(response.status).json(response.json);
    // Get field names of the "Section" model
    
  } catch (error) {
    console.error('Error:', error);
  } 
}
}

// Run the main function
export default handler;