import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  try {
    const user: any = JSON.parse(req.cookies.nookies_user!);
    const { url, displayName } = req.body;

    const userPicture = await prisma.userPicture.update({
      where: {
        userId: user.id,
      },
      data: {
        photoSet: url ? true : false,
        nameSet: displayName ? true : false,
      },
    });

    const updateData: { photoURL?: string; displayName?: string } = {};
    
    if (url !== undefined) {
      updateData.photoURL = url ?? userPicture?.basePhotoURL ?? "";
    }
    
    if (displayName !== undefined) {
      updateData.displayName = displayName ?? userPicture?.displayName ?? "";
    }

    const updateUser = await prisma.user.update({
      where: {
        id: user.id,
      },
      data: updateData,
      include: {
        UserSetting: true,
        userPicture: true,
      },
    });

    return res.status(200).json({ updateUser });
  } catch (error) {
    console.log("🚀 ~ error:", error);
    return res.status(400).json({ message: JSON.stringify(error) });
  }
};

export default handler;
