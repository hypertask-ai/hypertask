import prisma from "@/lib/prisma";

export const getHyperUser = () => {
  const hyperAiId = parseInt(process.env.NEXT_PUBLIC_HYPERAI_ID || "332", 10);
  return prisma.user.findFirst({ where: { id: hyperAiId } });
};
