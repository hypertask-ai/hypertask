import prisma from "@/lib/prisma";
import { json } from "@/utils/helperFunctions/helperFunctions";
import { getSessionUser } from "@/lib/auth/getSessionUser";

import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
    if (!session) return res.status(401).json({ message: "Unauthorized" });
    const adminPassword = process.env.ADMIN_USER_RESET_PW;
    if (!adminPassword || req.headers["x-admin-password"] !== adminPassword) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const { mode } = req.query;
        console.log("🚀 ~ consthandler:NextApiHandler= ~ mode:", mode)

        let whereConditions = {};

        const usersAll = await prisma.user.findMany({
            where: {
                AND: [
                    {
                        email: {
                            not: {
                                endsWith: "66loop.com"
                            }
                        }
                    },
                    {
                        email: {
                            not: {
                                endsWith: "vazco.eu"
                            }
                        }
                    },
                    {
                        email: {
                            not: {
                                endsWith: "vetsak.com"
                            }
                        }
                    }
                ]
            },
            select: {
                displayName: true,
                email: true,
                joinedAt: true,
                user_activity: {},
                _count: {
                    select: {
                        tasks: { where: { status: { not: "Deleted" } } },
                        comments: { where: { task: { status: { not: "Deleted" } } } },
                        assignees: { where: { task: { status: "Archive" } } },
                        projects: { where: { status: { not: "Deleted" } } },
                        members: { where: { project: { status: { not: "Deleted" } } } },
                        
                    }
                }
            }
        });
        
        console.log("🚀 ~ consthandler:NextApiHandler= ~ usersAll:", usersAll[0])

      return res.status(200).json(usersAll)
    } catch (error) {
      console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error)
      return res.status(500)
    }

  
}
export default handler