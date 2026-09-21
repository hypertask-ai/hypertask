// Define the API route

import leaveProject from '@/utils/controllers/projects/leave';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Check if the request is a POST request
  if (req.method === 'POST') {
    // Get the project ID and new section title from the request body
    const { projectId } = req.body;
    const user = JSON.parse(req.cookies.nookies_user!)


    try {
      const response = await leaveProject( projectId, parseInt(user.id))
      return res.status(response.status).json(response.json)


    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to add new section' });
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}
