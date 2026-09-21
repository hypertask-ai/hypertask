import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const sections = await prisma.section.findMany();
            let count  =0
            for (const section of sections) {
                await prisma.task.updateMany({
                  where: { sectionId: section.id }, 
                  data: { section: section.section_title },
                });
                count++
                console.log(count)
                // console.log("testing loop",task)
              }
           
           return res.status(200).json(count);
        } catch (error) {
            console.log({error})
            res.status(500).json({ message: "Internal server error" });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;