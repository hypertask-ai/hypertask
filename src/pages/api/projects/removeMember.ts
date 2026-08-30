import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import membersRemove from "@/utils/controllers/projects/removeMember";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";


const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        const session = verifySession(req.cookies[SESSION_COOKIE]);
        if (!session) {
            return res
                .status(401)
                .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
        }

        try {
            const { userId, projectId } = req.body;
            console.log("🚀 ~ file: removeMember.ts:9 ~ consthandler:NextApiHandler= ~ req.body:", req.body)
            if (!userId || !projectId) {
                return res.status(400).json({ message: "Missing required information" });
            }
            // const user = await prisma.user.findUnique({
            //     where: {
            //         id: userId
            //     }
            // })
            // if (!user) {
            //     return res.status(400).json({ message: "User not found" });
            // }
            // const project = await prisma.project.findUnique({
            //     where: {
            //         id: projectId
            //     }
            // })
            // if (!project) {
            //     return res.status(400).json({ message: "Project not valid" });
            // }

            // if(project.ownerId === userId) {
            //     return res.status(400).json({ message: "Cannot invite project owner" });
            // }

            // let member = await prisma.member.findFirst({
            //     where: {
            //         userId: userId,
            //         projectId: projectId
            //     }
            // })

            // if (member) {
            //     return res.status(200).json(member);
            // }

            // member = await prisma.member.create({
            //     data: {
            //         userId: userId,
            //         projectId: projectId
            //     }
            // })
            const response = await membersRemove(userId, projectId, session.id)
            return res.status(response.status).json(response.json);
        } catch (error) {
            console.log(error);
            return res.status(400).json({ message: JSON.stringify(error) });
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;
