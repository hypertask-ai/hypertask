'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { Step, CallBackProps } from 'react-joyride';
import { useTourStatus } from './useTourStatus';
import { TourId, TOUR_IDS } from '../types';
import { tourSteps } from '../config/steps';

// react-joyride is 102 KB and 84% of it never executes on the board: the board
// route loads zero tour steps, so <Joyride> renders null while the whole module
// is still downloaded, parsed and evaluated on first paint (HTPR-4508).
// Loading it dynamically means the chunk only arrives when a tour actually runs.
// ssr:false because Joyride measures live DOM targets and cannot render server-side.
const Joyride = dynamic(() => import('react-joyride'), { ssr: false });

// STATUS/ACTIONS/EVENTS are plain string constants in react-joyride, but importing
// them as values would pull the whole module back into the initial chunk and undo
// the dynamic import above. Inlined here instead; tests/joyride-constants.test.cjs
// asserts these still match the library so a version bump cannot drift them silently.
const STATUS = { FINISHED: 'finished', SKIPPED: 'skipped' } as const;
const ACTIONS = { PREV: 'prev' } as const;
const EVENTS = { STEP_AFTER: 'step:after', TARGET_NOT_FOUND: 'error:target_not_found' } as const;

type TourContextType = 'route' | 'component';

interface UseTourReturn {
  startTour: (tourIdOverride?: TourId) => void;
  startComponentTour: (componentId: string) => void;
  endTour: () => void;
  isTourActive: () => boolean;
  continueTourInModal: () => void;
  TourComponent: () => React.JSX.Element | null;
}

interface UseTourParams {
  tourId?: TourId;
  currentUser:  any | null; // Allow IUser or HUser (from useAuth)
}

export function useTour({ tourId = TOUR_IDS.TASK_WRITER, currentUser }: UseTourParams): UseTourReturn {
  const [run, setRun] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [tourContext, setTourContext] = useState<TourContextType>('route');
  const [currentTourId, setCurrentTourId] = useState<TourId>(tourId);
  const pathname = usePathname();
  
  // Get tour status tracking hooks
  const tourStatus = useTourStatus({ tourId: currentTourId });
  
  // Update currentTourId when tourId prop changes (from context)
  useEffect(() => {
    if (tourId && tourId !== currentTourId) {
      setCurrentTourId(tourId);
    }
  }, [tourId, currentTourId]);

  const loadStepsForRoute = useCallback((route: string): void => {
    if (tourSteps[route]) {
      // Filter steps to only include those with valid targets
      const validSteps = tourSteps[route].filter((step) => {
        if (step.target === 'body') return true;
        const element = document.querySelector(step.target as string);
        if (!element) {
          console.warn(`Element not found for tour step: ${step.target}`);
        }
        return !!element;
      });

      setSteps(validSteps);
      setStepIndex(0);
      console.log(`✅ Loaded ${validSteps.length} tour steps for route: ${route}`);
    } else {
      setSteps([]);
    }
  }, []);

  // Auto-load tour steps when route changes (only if not in middle of component tour)
  useEffect(() => {
    if (tourContext === 'route' && !run) {
      const route = pathname?.split('/').filter(Boolean)[0] || 'home';
      loadStepsForRoute(route);
    }
  }, [pathname, tourContext, run, loadStepsForRoute]);

  const loadStepsForComponent = useCallback((componentId: string): void => {
    setTourContext('component');

    if (tourSteps[componentId]) {
      // Filter steps to only include those with valid targets
      const validSteps = tourSteps[componentId].filter((step) => {
        if (step.target === 'body') return true;
        const element = document.querySelector(step.target as string);
        if (!element) {
          console.warn(`Element not found for tour step: ${step.target}`);
        }
        return !!element;
      });

      setSteps(validSteps);
      setStepIndex(0);

      console.log(`✅ Loaded ${validSteps.length} tour steps for component: ${componentId}`);

      // Start the tour for this component if steps were added
      if (validSteps.length > 0) {
        setTimeout(() => {
          setRun(true);
        }, 100);
      } else {
        console.warn(`No valid steps to show for component: ${componentId}`);
      }
    }
  }, []);

  const startTour = useCallback((tourIdOverride?: TourId): void => {
    // Reset tour state first to ensure fresh start
    setRun(false);
    setStepIndex(0);
    setTourContext('route');
    
    // Use the override tour ID if provided, otherwise use current tour ID or route-based tour
    const route = pathname?.split('/').filter(Boolean)[0] || 'project';
    
    // Determine which tour to start
    let tourKey: string;
    
    // Priority: tourIdOverride > tourId prop > currentTourId > route-based
    if (tourIdOverride && tourSteps[tourIdOverride]) {
      tourKey = tourIdOverride;
    } else if ((currentTourId === TOUR_IDS.TASK_WRITER || tourId === TOUR_IDS.TASK_WRITER) && tourSteps[TOUR_IDS.TASK_WRITER]) {
      tourKey = TOUR_IDS.TASK_WRITER;
    } else if ((currentTourId === TOUR_IDS.PROJECT || tourId === TOUR_IDS.PROJECT) && tourSteps[TOUR_IDS.PROJECT]) {
      tourKey = TOUR_IDS.PROJECT;
    } else {
      tourKey = tourSteps[route] ? route : 'project';
    }
    
    console.log("🚀 ~ startTour ~ tourKey:", tourKey, "tourIdOverride:", tourIdOverride, "tourId prop:", tourId, "currentTourId:", currentTourId);
    
    if (tourSteps[tourKey]) {
      setCurrentTourId(tourKey as TourId);
      loadStepsForRoute(tourKey);
      
      // Mark that user has started viewing this tour
      // This sets the _hasSeenAnyTour flag to prevent auto-showing tours
      tourStatus.markTourStarted();
      
      // Small delay to ensure steps are loaded, state is reset, and DOM is ready
      setTimeout(() => {
        setRun(true);
      }, 150);
    } else {
      console.warn(`No tour found for route: ${route} or tourId: ${currentTourId}`);
    }
  }, [pathname, loadStepsForRoute, tourStatus, currentTourId, tourId]);

  const startComponentTour = useCallback((componentId: string): void => {
    loadStepsForComponent(componentId);
  }, [loadStepsForComponent]);

  const endTour = useCallback((): void => {
    setRun(false);
    setStepIndex(0);
    setTourContext('route');
  }, []);

  const isTourActive = useCallback((): boolean => {
    return run;
  }, [run]);

  const continueTourInModal = useCallback((): void => {
    console.log('🎯 Continuing tour in create task modal');
    setRun(false);
    setTourContext('component');
    
    // Small delay to ensure modal is fully rendered
    setTimeout(() => {
      loadStepsForComponent('create-task-modal');
    }, 300);
  }, [loadStepsForComponent]);

  const handleJoyrideCallback = useCallback((data: CallBackProps) => {
    const { status, type, index, action } = data;
    console.log("🚀 ~ useTour ~ status:", status)

    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];
    console.log("🚀 ~ useTour ~ finishedStatuses:", finishedStatuses)

    if (finishedStatuses.includes(status)) {
      setRun(false);
      setStepIndex(0);
      setTourContext('route');
      
      // Mark tour as completed or skipped in database
      if (status === STATUS.FINISHED) {
        console.log('✅ Tour completed:', currentTourId);
        tourStatus.markComplete();
      } else if (status === STATUS.SKIPPED) {
        console.log('⏭️ Tour skipped:', currentTourId);
        tourStatus.markSkipped();
      }
    } else if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      const nextStepIndex = index + (action === ACTIONS.PREV ? -1 : 1);
      
      // Special handling for task-writer tour
      if (currentTourId === 'task-writer' && tourContext === 'route') {
        // Step 1 -> Step 2: Wait for modal to open (handled by interaction listeners)
        if (index === 0 && action !== ACTIONS.PREV) {
          console.log('⏸️ Task Writer Tour: Waiting for create task modal to open');
          setRun(false);
          return;
        }
        // Step 2 -> Step 3: Wait for CTRL+J (handled by interaction listeners)
        if (index === 1 && action !== ACTIONS.PREV) {
          console.log('⏸️ Task Writer Tour: Waiting for CTRL+J to open AI writer');
          setRun(false);
          return;
        }
      }
      
      // If we're on the "create task button" step and moving forward
      // The tour will pause here and resume when modal opens via continueTourInModal
      if (tourContext === 'route' && index === steps.length - 1 && action !== ACTIONS.PREV) {
        // User clicked the create button, pause tour
        console.log('⏸️ Pausing tour - waiting for modal to open');
        setRun(false);
        return;
      }
      
      setStepIndex(nextStepIndex);
    }
  }, [tourContext, currentTourId, tourStatus, steps.length]);

  const TourComponent = useCallback(() => {
    if (steps.length === 0) return null;

    return (
      <Joyride
        steps={steps}
        run={run}
        stepIndex={stepIndex}
        continuous
        showProgress
        showSkipButton
        callback={handleJoyrideCallback}
        
        styles={{
          
          options: {
            primaryColor: '#8b5cf6',
            zIndex: 10000,
            backgroundColor: 'var(--bg-sidebar)',
            textColor: 'var(--color-white-black)',
          },
          tooltip: {
            borderRadius: 4,
          },
          tooltipContainer: {
            textAlign: 'left',
          },
          tooltipTitle: {
            textAlign: 'left',
            fontWeight: 600,
            fontSize: '1rem',
          },
          tooltipContent: {
            textAlign: 'left',
            fontSize: '0.875rem',
            padding: '0.5rem 0',
          },
          buttonNext: {
            backgroundColor: 'var(--active-elementBg)',
            borderRadius: 4,
            fontSize: 14,
            padding: '8px 16px',
            color: 'var(--color-white-black)',
            fontWeight: 600,
            outline: 'none',
            boxShadow: 'none',
          },
          buttonBack: {
            color: 'var(--color-text-light-gray)',
            marginRight: 10,
            fontSize: 14,
            outline: 'none',
            boxShadow: 'none',
          },
          buttonSkip: {
            color: 'var(--color-text-light-gray)',
            fontSize: 14,
            outline: 'none',
            boxShadow: 'none',
          } }}
        locale={{
          back: 'Back',
          close: 'Close',
          last: 'Finish',
          next: 'Next',
          open: 'Open',
          skip: 'Skip' }}
        disableOverlayClose
        disableCloseOnEsc={false}
        spotlightClicks
        scrollToFirstStep
        scrollOffset={200}
        hideCloseButton={true}
      />
    );
  }, [steps, run, stepIndex, handleJoyrideCallback]);

  return {
    startTour,
    startComponentTour,
    endTour,
    isTourActive,
    continueTourInModal,
    TourComponent,
  };
}
