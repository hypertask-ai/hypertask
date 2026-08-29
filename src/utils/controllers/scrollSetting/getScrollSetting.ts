import prisma from "@/lib/prisma";

const getScrollSetting = async (userid: any) => {
  try {
    const result = await prisma.userSetting.findMany({
      where: {
        userId: userid,
      },
    });
    return {
      status: 200,
      res: result,
    };

    // res.status(200).json(comments);
  } catch (error) {
    console.log(error);
    return {
      status: 500,
      json: { message: "Internal server error" },
    };
  }
};

export default getScrollSetting;
