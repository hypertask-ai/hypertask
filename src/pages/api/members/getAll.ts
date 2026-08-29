import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import membersGetAll from "@/utils/controllers/members/getAll";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            const { projectId, teamMembers, teamId } = req.query;

            const user = JSON.parse(req.cookies.nookies_user!)
            if (!projectId) {
                return res.status(200).json([]);
            }

            // const members = await prisma.member.findMany({
            //     where: {
            //         projectId: parseInt(projectId as string),
            //     },
            //     include: {
            //         user: true
            //     }
            // })
            const response = await membersGetAll(projectId,user, teamMembers, teamId)
            return res.status(response.status).json(response.json);
        } catch (error) {
            console.log(error);
            return res.status(200).json([]);
        }
    } else {
        return res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;