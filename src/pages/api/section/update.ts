// Import PrismaClient from the generated Prisma client
import sectionUpdate from '@/utils/controllers/section/update';
import { broadcastBoardChange } from '@/lib/realtime/server';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

// Create an instance of PrismaClient

// Example usage
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
if (req.method==="POST"){

  const { sectionId,newSection  } = req.body;
  let currentUser;
  try {
    currentUser = req.cookies.nookies_user
      ? JSON.parse(req.cookies.nookies_user)
      : undefined;
  } catch {
    currentUser = undefined;
  }

  if (!currentUser?.id) {
      return res.status(401).json({ message: "Unauthorized" });
  }

  if (!sectionId ||!newSection) {
      return res.status(400).json({ message: "Missing Required Data" });
  }
  try {
    // Get all sections
    // const toUpdate = await prisma.section.update({
    //     where:{
    //         id:sectionId
    //     },
    //     data:{
    //         ...newSection
    //     }
    // });
    // if(!toUpdate) return res.status(400).json({message:"Section Not Found"})
    // if(toUpdate.deleted===true) return res.status(204).json(toUpdate)
    const response = await sectionUpdate( currentUser.id, sectionId,newSection )
    if (response?.status === 200 || response?.status === 204) {
      void broadcastBoardChange((response?.json as any)?.projectId ?? newSection?.projectId, { originUserId: currentUser.id });
    }
    return res.status(response?.status).json(response?.json);
    // Get field names of the "Section" model
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ message: "Section update failed" });
  }
}
}

// Run the main function
export default handler;
