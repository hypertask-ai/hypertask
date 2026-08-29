import prisma from "@/lib/prisma";

export const updateTrial = async (id: number) => {
  await prisma.userSetting.update({
    where: {
      userId: id,
    },
    data: {
      trialStatus: true,
    },
  });
};
