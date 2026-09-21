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

    // ----------------- script to change notification status ---------------
    // const allUsers = await prisma.user.findMany();
    // console.log("alluser",allUsers);
    // // Step 2: Loop through all users and create a userSetting for each one
    // for (const user of allUsers) {
    //     console.log("alluser",user);
    //   const createdUserSetting = await prisma.userSetting.create({
    //     data: {
    //       userId: user.id,
    //       notification:false
    //     },
    //   });
    //  console.log("createdUserSetting",createdUserSetting)
    //   await prisma.user.update({
    //     where: { id: user.id },
    //     data: {
    //       UserSettingId :createdUserSetting.id,
    //     },
    //   });
    // }
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