import { logger as htLogger } from "#logger";
import { useEffect, useCallback } from 'react';
import axios from 'axios';

interface UseDeferredSubscriptionCheckProps {
  teamId?: number;
  enabled?: boolean;
  delay?: number; // Delay in milliseconds before checking
}

export const useDeferredSubscriptionCheck = ({ 
  teamId, 
  enabled = true, 
  delay = 2000 // Default 2 second delay after page load
}: UseDeferredSubscriptionCheckProps) => {
  
  const checkSubscription = useCallback(async (teamId: number) => {
    try {
      htLogger.info('🔄 Starting deferred subscription check for team:', teamId);
      
      const response = await axios.post('/api/subscription/check', { teamId });
      
      if (response.data.success) {
        htLogger.info('✅ Subscription check completed:', response.data.subscriptionStatus);
      } else {
        htLogger.error('❌ Subscription check failed:', response.data.error);
      }
    } catch (error) {
      htLogger.error('❌ Subscription check request failed:', error);
    }
  }, []);

  useEffect(() => {
    if (!enabled || !teamId) return;

    // Defer the subscription check to not impact initial render
    const timeoutId = setTimeout(() => {
      checkSubscription(teamId);
    }, delay);

    return () => clearTimeout(timeoutId);
  }, [teamId, enabled, delay, checkSubscription]);

  return { checkSubscription };
}; 