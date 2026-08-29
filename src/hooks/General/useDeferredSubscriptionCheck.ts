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
      console.log('🔄 Starting deferred subscription check for team:', teamId);
      
      const response = await axios.post('/api/subscription/check', { teamId });
      
      if (response.data.success) {
        console.log('✅ Subscription check completed:', response.data.subscriptionStatus);
      } else {
        console.error('❌ Subscription check failed:', response.data.error);
      }
    } catch (error) {
      console.error('❌ Subscription check request failed:', error);
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