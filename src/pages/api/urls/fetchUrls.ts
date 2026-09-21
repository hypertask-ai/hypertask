// Import PrismaClient from the generated Prisma client
import fetchUrls from '@/utils/controllers/urls/fetchUrls';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';


// Example usage
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const { taskId, commentId } = req.query;
            if (!taskId) {
                return res.status(400).json({ message: "User id is required" });
            }
            const response = await  fetchUrls(taskId,commentId as string)
         
            return res.status(response.status).json(response.json);
            // console.log(comments);
        } catch (error) {
            console.log(error);
            return res.status(500).json({ message: "Internal server error" });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
}

// Run the main function
export default handler;


