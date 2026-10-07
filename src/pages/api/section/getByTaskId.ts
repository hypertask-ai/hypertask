import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
// Import PrismaClient from the generated Prisma client
import sectionGetByTask from '@/utils/controllers/section/getByTask';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { getSessionUser } from "@/lib/auth/getSessionUser";

// Create an instance of PrismaClient

// Example usage
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
if (req.method==="POST"){

    const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
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
    const response = await sectionGetByTask(taskId, session.userId)
    return res.status(response.status).json(response.json);
    // Get field names of the "Section" model
    
  } catch (error) {
    console.error('Error:', error);
  } 
}
}

// Run the main function
export default withTaskWriteFlag(handler, "POST", async () =>
  (await import("@/lib/api/section-writes/get-by-task")).POST
);