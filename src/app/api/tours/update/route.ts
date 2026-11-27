import { NextResponse, type NextRequest } from "next/server";
import { logDesktopCliAuthorization } from "@/lib/auth/desktopCliTokenUser";
import prisma from '@/lib/prisma';
import type { ProductToursData } from '@/lib/tours';
import { getSessionUser } from "@/lib/auth/getSessionUser";

export async function POST(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized', code: 'SESSION_REQUIRED' }, { status: 401 });
  }

  const userId = session.userId;
  let status = 500;

  try {
    const { tourId, completed, skipped } = await request.json() as {
      tourId?: string;
      completed?: boolean;
      skipped?: boolean;
    };

    if (!tourId) {
      status = 400;
      return NextResponse.json({ message: 'tourId is required' }, { status });
    }

    const userSetting = await prisma.userSetting.findUnique({
      where: { userId: userId },
      select: { productTours: true },
    });

    const currentTours = (userSetting?.productTours || {}) as ProductToursData;

    const existingTourData = currentTours[tourId];
    const existingCompletedAt =
      existingTourData && typeof existingTourData !== 'boolean'
        ? existingTourData.completedAt
        : undefined;

    const updatedTours: ProductToursData = {
      ...currentTours,
      _hasSeenAnyTour: true,
      [tourId]: {
        completed: completed || false,
        skipped: skipped || false,
        completedAt: completed ? new Date().toISOString() : existingCompletedAt,
        lastSeenAt: new Date().toISOString(),
      },
    };

    await prisma.userSetting.update({
      where: { userId: userId },
      data: { productTours: updatedTours },
    });

    console.log(`✅ Tour status updated: ${tourId}`, { completed, skipped });

    status = 200;
    return NextResponse.json({ success: true, tours: updatedTours });
  } catch (error) {
    console.error('Error updating tour status:', error);
    return NextResponse.json({
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  } finally {
    logDesktopCliAuthorization(session, "shared-session", status, {
      url: new URL(request.url).pathname,
      method: request.method,
    });
  }
}
