# Tours Module

Centralized module for all tour-related functionality in Hypertasks. This module provides product tours using `react-joyride` to guide users through features.

## 📁 Structure

```
src/lib/tours/
├── index.ts                 # Main exports - import everything from here
├── types/
│   └── index.ts            # TypeScript types and constants (TOUR_IDS)
├── config/
│   └── steps.ts            # Tour step definitions organized by tour ID
├── hooks/
│   ├── useTour.ts          # Main tour hook - manages tour state and rendering
│   └── useTourStatus.ts    # Tour status tracking (completed/skipped)
├── context/
│   └── TourContext.tsx     # React context provider for tour functionality
└── api/
    └── (API routes stay in pages/api/tours/)
```

## 🚀 Quick Start

### Import Everything from One Place

```tsx
import { 
  TOUR_IDS, 
  useTour, 
  useTourStatus, 
  TourProvider,
  useTourContext 
} from '@/lib/tours';
```

### Manually Start a Tour

```tsx
import { useTourContext } from '@/lib/tours';

function MyComponent() {
  const { startTour } = useTourContext();
  
  return (
    <button onClick={startTour}>
      Show Tour
    </button>
  );
}
```

### Check Tour Status

```tsx
import { TOUR_IDS, useTourStatus } from '@/lib/tours';

function MyComponent() {
  const { hasSeenAnyTour, shouldShowTour, markComplete } = useTourStatus({
    tourId: TOUR_IDS.PROJECT,
  });
  
  if (hasSeenAnyTour) {
    return <div>Welcome back!</div>;
  }
  
  return <div>First time user!</div>;
}
```

## 📚 API Reference

### Types

- `TOUR_IDS` - Tour ID constants (PROJECT, CREATE_TASK_MODAL, SHORTCUTS, TASK_DETAIL)
- `TourId` - Type for tour IDs
- `TourStatus` - Status object for individual tours
- `ProductToursData` - Complete tours data structure

### Hooks

#### `useTour({ tourId, currentUser })`
Main hook for managing tour state and rendering.

**Returns:**
- `startTour()` - Start the tour
- `startComponentTour(id)` - Start a component-specific tour
- `endTour()` - End the tour
- `isTourActive()` - Check if tour is active
- `continueTourInModal()` - Continue tour in modal
- `TourComponent` - The Joyride component to render

#### `useTourStatus({ tourId })`
Track and update tour completion status.

**Returns:**
- `hasSeenAnyTour` - Whether user has seen ANY tour
- `shouldShowTour` - Whether this specific tour should be shown
- `markComplete()` - Mark tour as completed
- `markSkipped()` - Mark tour as skipped
- `markTourStarted()` - Mark tour as started

### Context

#### `TourProvider`
Wrap your app with this provider to enable tour functionality.

```tsx
import { TourProvider } from '@/lib/tours';

<TourProvider>
  <App />
</TourProvider>
```

#### `useTourContext()`
Access tour functions from context.

**Returns:**
- `startTour()` - Start the tour
- `isTourActive()` - Check if tour is active
- `continueTourInModal()` - Continue tour in modal

## 🎯 Adding New Tours

1. **Add Tour ID** to `types/index.ts`:
```ts
export const TOUR_IDS = {
  // ... existing
  MY_NEW_TOUR: 'my-new-tour',
} as const;
```

2. **Add Tour Steps** to `config/steps.ts`:
```ts
export const tourSteps: TourStepsConfig = {
  // ... existing
  'my-new-tour': [
    {
      target: '.my-element',
      content: 'This is my new tour step!',
      title: 'My New Tour',
      placement: 'bottom',
    },
  ],
};
```

3. **Use It**:
```tsx
import { TOUR_IDS, useTourContext } from '@/lib/tours';

const { startTour } = useTourContext();

startTour(TOUR_IDS.MY_NEW_TOUR);
```

## 🔧 Configuration

Tour steps are defined in `config/steps.ts`. Each step can have:
- `target` - CSS selector or element ID
- `content` - Step content text
- `title` - Step title
- `placement` - Tooltip placement (top, bottom, left, right, center)
- `spotlightClicks` - Allow clicking through overlay
- `disableBeacon` - Hide the beacon pulse
- `hideFooter` - Hide navigation buttons

## 📝 Notes

- **API Routes**: Must remain in `pages/api/tours/` for Next.js routing
- **Database**: Uses `UserSetting.productTours` JSON field to track status
- **Context**: TourProvider must wrap components that use tour hooks

