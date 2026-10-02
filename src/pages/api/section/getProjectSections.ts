// Import PrismaClient from the generated Prisma client
import sectionGetProjectSections from '@/utils/controllers/section/getProjectSections';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { getSessionUser } from "@/lib/auth/getSessionUser";

// Create an instance of PrismaClient

// Example usage
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
if (req.method==="POST"){
  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const userId = session.userId;
  const {  projectId } = req.body;
  if (!projectId) {
      return res.status(400).json({ message: "Missing Required Credentials" });
  }
  try {
    const response = await sectionGetProjectSections( projectId, userId)
    return res.status(response.status).json(response.json);
    // Get field names of the "Section" model
    
  } catch (error) {
    console.error('Error:', error);
  } 
}
}

// Run the main function
export default handler;