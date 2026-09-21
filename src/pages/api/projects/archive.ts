

// Define the API route
import addSection from '@/utils/controllers/projects/addSection';
import archiveProject from '@/utils/controllers/projects/archiveProject';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Check if the request is a POST request
  if (req.method === 'POST') {
    // Get the project ID and new section title from the request body
    const { projectId } = req.body;
    const user = JSON.parse(req.cookies.nookies_user!)
    try {
      const response = await archiveProject( projectId, parseInt(user.id))
      return res.status(response.status).json(response.json)
      // Find the project by ID and update the sections array
      // const updatedProject = await prisma.project.update({
      //   where: { id: currProjectID },
      //   data: {
      //     sections: {
      //       push: newSectionTitle, 
      //     },
      //   },
      // });

      // return res.status(200).json(updatedProject);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to add new section' });
    }
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}
