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

/**
 * Hook to check and update tour status
 * @param tourId - The ID of the tour to check
 * @param currentUser - Optional current user object (uses internal hook if not provided)
 */
export function useTourStatus({ tourId }: UseTourStatusParams) {
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const [, setRecoilUser] = useRecoilState(currentUserAtom);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Update both cookie and Recoil atom with new tour data
   * This ensures useCurrentUser() picks up changes immediately
   */
  const updateUserData = (updatedProductTours: ProductToursData) => {
    if (!currentUser) return;
    
    const updatedUser = {
      ...currentUser,
      UserSetting: {
        ...currentUser.UserSetting,
        productTours: updatedProductTours,
      },
    };
    
    // Update cookie immediately
    nookies.set(
      null,
      authConfig.cookies.user,
      JSON.stringify(slimUserForCookie(updatedUser)),
      {
        maxAge: authConfig.cookies.maxAge,
        path: authConfig.cookies.options.path,
      },
    );
    
    // Update Recoil atom immediately so useCurrentUser() can pick it up
    setRecoilUser(updatedUser);
  };

  /**
   * Generic function to update tour status
   */
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

      // Update cookie and Recoil atom immediately with fresh data from API
      if (data.tours) {
        updateUserData(data.tours);
      }

      // Invalidate and refetch user query (for any other components that use it)
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

  /**
   * Check if this specific tour should be shown
   */
  const shouldShowTour = (): boolean => {
    if (!currentUser) return false;
    
    const productTours = currentUser?.UserSetting?.productTours as ProductToursData;
    
    // If no tour data exists, show the tour
    if (!productTours) return true;
    
    // If user has seen any tour, don't auto-show
    if (productTours._hasSeenAnyTour) return false;
    
    // Check if this specific tour was completed or skipped
    const tourData = productTours[tourId];
    if (tourData && typeof tourData !== 'boolean') {
      if (tourData.completed || tourData.skipped) return false;
    }
    
    return true;
  };

  /**
   * Check if user has seen ANY tour before
   * This is used to determine if we should auto-start the first tour
   */
  const hasSeenAnyTour = (): boolean => {
    if (!currentUser?.UserSetting?.productTours) return false;
    
    const tours = currentUser.UserSetting.productTours as ProductToursData;
    return tours._hasSeenAnyTour === true;
  };

  /**
   * Check if a specific tour is completed
   */
  const isTourCompleted = (): boolean => {
    if (!currentUser?.UserSetting?.productTours) return false;
    
    const tours = currentUser.UserSetting.productTours as ProductToursData;
    const tourData = tours[tourId];
    return tourData && typeof tourData !== 'boolean' ? tourData.completed === true : false;
  };

  /**
   * Check if a specific tour is skipped
   */
  const isTourSkipped = (): boolean => {
    if (!currentUser?.UserSetting?.productTours) return false;
    
    const tours = currentUser.UserSetting.productTours as ProductToursData;
    const tourData = tours[tourId];
    return tourData && typeof tourData !== 'boolean' ? tourData.skipped === true : false;
  };

  /**
   * Mark tour as completed
   */
  const markComplete = async () => {
    const result = await updateTourStatus({ completed: true });
    if (result) {
      console.log(`✅ Tour marked as completed: ${tourId}`);
    }
    return result;
  };

  /**
   * Mark tour as skipped
   */
  const markSkipped = async () => {
    const result = await updateTourStatus({ skipped: true });
    if (result) {
      console.log(`⏭️ Tour marked as skipped: ${tourId}`);
    }
    return result;
  };

  /**
   * Mark that user has started viewing a tour (but not completed)
   * This sets the _hasSeenAnyTour flag to prevent auto-showing tours in the future
   */
  const markTourStarted = async () => {
    const result = await updateTourStatus({ started: true });
    if (result) {
      console.log(`👀 Tour started: ${tourId}`);
    }
    return result;
  };

  /**
   * Reset a tour (mark as not completed and not skipped)
   * Useful for allowing users to replay tours
   */
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
    // State
    shouldShowTour: shouldShowTour(),
    hasSeenAnyTour: hasSeenAnyTour(),
    isTourCompleted: isTourCompleted(),
    isTourSkipped: isTourSkipped(),
    isLoading,
    error,
    
    // Actions
    markComplete,
    markSkipped,
    markTourStarted,
    resetTour,
  };
}
