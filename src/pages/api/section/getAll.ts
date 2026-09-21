// Import PrismaClient from the generated Prisma client
import sectionGetAll from '@/utils/controllers/section/getAll';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

// Create an instance of PrismaClient

// Example usage
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
if (req.method==="POST"){
  const { userId } = req.body;
  if (!userId ) {
      return res.status(400).json({ message: "Missing Required Credentials" });
  }
  try {
    const response = await sectionGetAll(userId)
    // Get all sections
    // const sections = await prisma.section.findMany();
    // console.log('Field Names:', Prisma.SectionScalarFieldEnum);

    return res.status(response.status).json(response.json);
    // Get field names of the "Section" model
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({error:error})
  } 
}
}

// Run the main function
export default handler;