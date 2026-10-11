import { withTaskWriteFlag } from "@/lib/api/task-writes/route";


// Define the API route
import deleteProject from '@/utils/controllers/projects/delete';
import { NextApiRequest, NextApiResponse } from 'next';
import { getSessionUser } from "@/lib/auth/getSessionUser";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Check if the request is a POST request
  if (req.method === 'POST') {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;
    // Get the project ID and new section title from the request body
    const { projectId } = req.body;
    try {
      const response = await deleteProject( projectId, userId)
      return res.status(response.status).json(response.json)

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to add new section' });
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}


export default withTaskWriteFlag(handler, "POST", async () =>
  (await import("@/lib/api/project-writes/delete")).POST,
);
