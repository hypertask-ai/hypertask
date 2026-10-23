
import type { NextApiRequest, NextApiResponse } from 'next'
import getTrashByProjectId from '@/utils/controllers/trash/getByProjectId';
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { parsePositiveInt } from "@/lib/parsePositiveInt";



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;
    const projectId = parsePositiveInt(req.query.projectId)

    if (!projectId) return res.status(400).json({message:"Missing Required information"})

    const response = await getTrashByProjectId({projectId, userId})
    if (!response) return res.status(404).json({ message: "Project not found" })
    return res.status(200).json(response)
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
