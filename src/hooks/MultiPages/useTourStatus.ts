import { useQueryClient } from '@tanstack/react-query';
import { ProductToursData, TourId } from '@/models/Tours/types';
import { IUser } from '@/models/model';
import useCurrentUser from '../General/useCurrentUserCheckFromCookies';
import { useState } from 'react';
import nookies from 'nookies';
import { useRecoilState } from '@/lib/state';
import { currentUserAtom } from '@/store';
import authConfig from '@/lib/configs/auth.config';
import { slimUserForCookie } from '@/lib/auth/slimUserCookie';

interface UseTourStatusParams {
  tourId: TourId;
}

interface TourUpdatePayload {
  tourId: TourId;
  userId: string;
  completed?: boolean;
  skipped?: boolean;
  started?: boolean;
}

export function useTourStatus({ tourId }: UseTourStatusParams) {
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const [, setRecoilUser] = useRecoilState(currentUserAtom);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateUserData = (updatedProductTours: ProductToursData) => {
    if (!currentUser) return;
    
    const updatedUser = {
      ...currentUser,
      UserSetting: {
        ...currentUser.UserSetting,
        productTours: updatedProductTours,
      },
    };
    
    nookies.set(
      null,
      authConfig.cookies.user,
      JSON.stringify(slimUserForCookie(updatedUser)),
      {
        maxAge: authConfig.cookies.maxAge,
        path: authConfig.cookies.options.path,
      },
    );
    
    setRecoilUser(updatedUser);
  };

  const updateTourStatus = async (payload: Omit<TourUpdatePayload, 'userId' | 'tourId'>) => {
    if (!currentUser?.id) {
      const errorMsg = 'No user ID available';
      console.error(errorMsg);
      setError(errorMsg);
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/tours/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tourId, 
          userId: currentUser.id,
          ...payload
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `Failed to update tour: ${response.status}`);
      }

      const data = await response.json();

      if (data.tours) {
        updateUserData(data.tours);
      }

      await queryClient.invalidateQueries({ queryKey: ['fetchUser'] });
      await queryClient.refetchQueries({ queryKey: ['fetchUser'] });

      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update tour status';
      console.error('Tour update error:', errorMessage);
      setError(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const shouldShowTour = (): boolean => {
    if (!currentUser) return false;
    
    const productTours = currentUser?.UserSetting?.productTours as ProductToursData;
    
    if (!productTours) return true;
    
    if (productTours._hasSeenAnyTour) return false;
    
    const tourData = productTours[tourId];
    if (tourData && typeof tourData !== 'boolean') {
      if (tourData.completed || tourData.skipped) return false;
    }
    
    return true;
  };

  const hasSeenAnyTour = (): boolean => {
    if (!currentUser?.UserSetting?.productTours) return false;
    
    const tours = currentUser.UserSetting.productTours as ProductToursData;
    return tours._hasSeenAnyTour === true;
  };

  const isTourCompleted = (): boolean => {
    if (!currentUser?.UserSetting?.productTours) return false;
    
    const tours = currentUser.UserSetting.productTours as ProductToursData;
    const tourData = tours[tourId];
    return tourData && typeof tourData !== 'boolean' ? tourData.completed === true : false;
  };

  const isTourSkipped = (): boolean => {
    if (!currentUser?.UserSetting?.productTours) return false;
    
    const tours = currentUser.UserSetting.productTours as ProductToursData;
    const tourData = tours[tourId];
    return tourData && typeof tourData !== 'boolean' ? tourData.skipped === true : false;
  };

  const markComplete = async () => {
    const result = await updateTourStatus({ completed: true });
    if (result) {
      console.log(`✅ Tour marked as completed: ${tourId}`);
    }
    return result;
  };

  const markSkipped = async () => {
    const result = await updateTourStatus({ skipped: true });
    if (result) {
      console.log(`⏭️ Tour marked as skipped: ${tourId}`);
    }
    return result;
  };

  const markTourStarted = async () => {
    const result = await updateTourStatus({ started: true });
    if (result) {
      console.log(`👀 Tour started: ${tourId}`);
    }
    return result;
  };

  const resetTour = async () => {
    const result = await updateTourStatus({ 
      completed: false, 
      skipped: false 
    });
    if (result) {
      console.log(`🔄 Tour reset: ${tourId}`);
    }
    return result;
  };

  return {
    shouldShowTour: shouldShowTour(),
    hasSeenAnyTour: hasSeenAnyTour(),
    isTourCompleted: isTourCompleted(),
    isTourSkipped: isTourSkipped(),
    isLoading,
    error,
    
    markComplete,
    markSkipped,
    markTourStarted,
    resetTour,
  };
}
