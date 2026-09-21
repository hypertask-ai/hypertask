
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        const { id } = req.body;
        try {
            const deletedRecord = await prisma.follower.delete({
              where: {
                id,
              },
            });
        
            res.json({ message: 'Record deleted', deletedRecord });
          } catch (error) {
            res.status(500).json({ error: 'Error deleting record' });
          }
        
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;