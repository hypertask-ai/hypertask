import { env as appEnv } from "#env";
import prisma from "@/lib/prisma";

export const getHyperUser = () => {
  const hyperAiId = parseInt(appEnv.NEXT_PUBLIC_HYPERAI_ID || "332", 10);
  return prisma.user.findFirst({ where: { id: hyperAiId } });
};
