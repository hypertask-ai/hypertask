import { Prisma, PrismaClient } from "@prisma/client";

import prisma from "@/lib/prisma";


const changeNotificationStatus = async (userId:number, notification:boolean) => {
  try {
    const update = await prisma.userSetting.update({
        where:{
            userId:userId
        },
        data:{
            notification: notification
        }
    })

    const updateUser = await prisma.user.findFirst({
      where: {
        id: userId,
      },
      include: {
        UserSetting: true,
        userPicture: true,
      },
    });

      return {
        status: 200,
        res: updateUser,
      };
    }
   catch (error) {
    console.log(error);
    return {
      status: 400,
      json: { message: JSON.stringify(error) },
    };
  }
};

export default changeNotificationStatus;