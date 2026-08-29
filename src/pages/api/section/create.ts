import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { IUser } from '@/models/model';
import * as sectionService from '@/utils/controllers/section/sectionService';
import getProjectView from '@/utils/controllers/projects/views/viewsHelperAPIfunctions';
import { broadcastBoardChange } from '@/lib/realtime/server';

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "POST") {
        try {
            const { projectId, title, ranking, after_section_id } = req.body;
            if (!projectId || !title) return res.status(400).json({ message: "Missing projectId or title" });
            // Ranking is optional: with neither ranking nor after_section_id the
            // service appends the column after the board's last section, which is
            // what "Add column" means. Clients must not compute the rank themselves.
            const user: IUser | undefined = req.cookies.nookies_user
                ? JSON.parse(req.cookies.nookies_user)
                : undefined;
            if (!user) return res.status(401).json({ message: "Unauthorized" });

            const projectIdNum = typeof projectId === 'string' ? parseInt(projectId, 10) : projectId;
            const afterSectionIdNum = after_section_id != null
                ? (typeof after_section_id === 'string' ? parseInt(after_section_id, 10) : after_section_id)
                : undefined;

            const response = await sectionService.createSection({
                    projectId,
                    title,
                    ranking,
                    afterSectionId: afterSectionIdNum,
                    userId: user.id
                  })

            if (response.status !== 200) {
                return res.status(response.status).json(response.json);
            }

            const project_view_updated = await getProjectView(projectIdNum, user.id)

            void broadcastBoardChange(projectIdNum, { originUserId: user.id });

            return res.status(200).json({
                message: "Section created successfully",
                section: response.json,
                project_view: project_view_updated,
            });
        } catch (error) {
            console.log('Error creating section:', error);
            return res.status(500).json({ message: "Internal Server Error" });
        }
    }
    return res.status(405).json({ message: "Method Not Allowed" });
}

export default handler
