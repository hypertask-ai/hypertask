import prisma from "@/lib/prisma";
import { ScrollSetting } from "@prisma/client";
import { invalidateUserPreferenceCache } from "../users/fetch_preferences";


const changeScrollSetting = async (userId: number, setting: ScrollSetting) => {
  try {
    const update = await prisma.userSetting.update({
      where: {
        userId: userId,
      },
      data: {
        scrollSetting: setting,
      },
    });
    await invalidateUserPreferenceCache(userId);
    return {
      status: 200,
      res: update,
    };
  } catch (error) {
    console.log(error);
    return {
      status: 400,
      json: { message: JSON.stringify(error) },
    };
  }
};

export default changeScrollSetting;
