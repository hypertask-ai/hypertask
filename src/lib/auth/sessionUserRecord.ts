import prisma from "@/lib/prisma";
import type { IUser } from "@/models/model";

// HTPR-6801: routes used to take the acting user from the nookies_user cookie,
// which carried the profile fields that activity rows and notifications store
// (fromUser.displayName, photoURL). The signed session only has the id, so load
// those fields for the actor. Falls back to an id-only actor if the lookup fails.
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
    // keep the id-only actor below
  }
  return { id: userId } as IUser;
}
