// Import PrismaClient from the generated Prisma client
import sectionGetProjectSections from '@/utils/controllers/section/getProjectSections';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

// Create an instance of PrismaClient

// Example usage
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
if (req.method==="POST"){
  const {  projectId } = req.body;
  if (!projectId) {
      return res.status(400).json({ message: "Missing Required Credentials" });
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
    const user: any = JSON.parse(req.cookies.nookies_user!)
    const response = await sectionGetProjectSections( projectId, user.id)
    return res.status(response.status).json(response.json);
    // Get field names of the "Section" model
    
  } catch (error) {
    console.error('Error:', error);
  } 
}
}

// Run the main function
export default handler;