import prisma from "@/lib/prisma";
import type { IUser } from "@/models/model";

export async function loadSessionUserRecord(userId: number): Promise<IUser> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        uid: true,
        displayName: true,
        photoURL: true,
        email: true,
        accountId: true,
      },
    });
    if (user) return user as IUser;
  } catch {
  }
  return { id: userId } as IUser;
}
