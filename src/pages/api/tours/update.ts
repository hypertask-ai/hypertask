import type { NextApiRequest, NextApiResponse } from 'next';
import { getCurrentUserFromCookies } from '@/utils/getCurrentUser';
import prisma from '@/lib/prisma';
import { ProductToursData } from '@/lib/tours';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = verifySession(req.cookies[SESSION_COOKIE]);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized', code: 'SESSION_REQUIRED' });
  }

  const userId = session.id;

  try {
    const { tourId, completed, skipped } = req.body;

    if (!tourId) {
      return res.status(400).json({ message: 'tourId is required' });
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

    return res.status(200).json({ success: true, tours: updatedTours });
  } catch (error) {
    console.error('Error updating tour status:', error);
    return res.status(500).json({ 
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
