# Product Tours Implementation Guide

> **Scope:** These Joyride product tours remain available. The separate keyboard-first tutorials at `/learn` and `/interactive-onboarding` are disabled under https://app.hypertask.ai/detail/project-15/5424.

## Overview
A comprehensive tour tracking system has been implemented using react-joyride. The system tracks which tours users have seen and automatically shows the project tour ONLY to first-time users who have never seen any tour before.

## Key Features

### 1. **Once-and-Done Behavior** ✅
- Once a user sees **ANY** tour, they will **NEVER** see any tour auto-start again
- Uses `_hasSeenAnyTour` flag in the database to track this
- Tours can still be manually triggered by the user

### 2. **Smart Tour Tracking**
- Individual tour completion status (completed/skipped)
- Tracks when each tour was last seen
- Tracks completion timestamps

### 3. **Tour Priority**
- **First Tour**: `project` (Kanban intro) - Auto-starts for brand new users
- Other tours must be manually triggered or coded to show in specific contexts

---

## Files Created/Modified

### New Files
1. **`src/models/Tours/types.ts`**
   - Tour type definitions
   - `TOUR_IDS` constants (PROJECT, CREATE_TASK_MODAL, SHORTCUTS, TASK_DETAIL)
   - `ProductToursData` type with `_hasSeenAnyTour` flag

2. **`src/pages/api/tours/update.ts`**
   - API endpoint to update tour status
   - Automatically sets `_hasSeenAnyTour: true` when any tour is tracked

3. **`src/hooks/MultiPages/useTourStatus.ts`**
   - Hook to check if a tour should be shown
   - Hook to mark tours as completed/skipped/started
   - `hasSeenAnyTour()` function to check if user has seen any tour

### Modified Files
1. **`src/prisma/schema.prisma`**
   - Added `productTours Json @default("{}")` to UserSetting model
   - Migration created: `20251029131024_add_product_tours_to_user_settings`

2. **`src/hooks/MultiPages/useTour.tsx`**
   - Now accepts `tourId` and `currentUser` parameters
   - Automatically marks tour as started when shown
   - Automatically marks tour as completed/skipped on finish
   - Integrated with `useTourStatus` hook

3. **`src/lib/contexts/TourContext.tsx`**
   - Updated to pass `currentUser` from `useAuth` to `useTour`
   - Uses `TOUR_IDS.PROJECT` as default tour

4. **`src/app/[...boardURL]/LandingPage.tsx`**
   - Added auto-start logic in `SectionComp` component
   - Only auto-starts if `!hasSeenAnyTour` and `shouldShowTour`
   - 2-second delay to ensure page is fully rendered

---

## Database Schema

```json
// UserSetting.productTours structure
{
  "_hasSeenAnyTour": true,  // Global flag - set to true when ANY tour is seen
  "project": {
    "completed": true,
    "completedAt": "2025-01-29T12:00:00Z",
    "skipped": false,
    "lastSeenAt": "2025-01-29T12:00:00Z"
  },
  "create-task-modal": {
    "completed": false,
    "skipped": true,
    "lastSeenAt": "2025-01-29T12:05:00Z"
  }
}
```

---

## Usage Examples

### Check if Tour Should Auto-Show
```typescript
import { useTourStatus } from '@/hooks/MultiPages/useTourStatus';
import { TOUR_IDS } from '@/models/Tours/types';

const { shouldShowTour, hasSeenAnyTour } = useTourStatus({ 
  tourId: TOUR_IDS.PROJECT, 
  currentUser 
});

// Only auto-start for BRAND NEW users
if (!hasSeenAnyTour && shouldShowTour) {
  startTour();
}
```

### Manually Start a Specific Tour
```typescript
import { useTourContext } from '@/lib/contexts/TourContext';

const { startTour } = useTourContext();

// User clicks "Show Tour" button
const handleShowTour = () => {
  startTour(); // Will start the 'project' tour
};
```

### Start a Different Tour (Custom Component)
```typescript
import { useTour } from '@/hooks/MultiPages/useTour';
import { TOUR_IDS } from '@/models/Tours/types';

const MyComponent = () => {
  const { startTour, TourComponent } = useTour({ 
    tourId: TOUR_IDS.SHORTCUTS, 
    currentUser 
  });
  
  return (
    <div>
      <button onClick={startTour}>Show Keyboard Shortcuts Tour</button>
      <TourComponent />
    </div>
  );
};
```

---

## Available Tours

All tours are defined in `src/hooks/MultiPages/useTour.tsx`:

1. **`project`** - Main Kanban board introduction
2. **`create-task-modal`** - Task creation with AI assistance
3. **`shortcuts`** - Keyboard shortcuts overview
4. **`task-detail`** - Task detail view features

---

## Flow Diagram

```
User visits app for first time
    ↓
LandingPage loads → checks hasSeenAnyTour()
    ↓
Is false? → Auto-start 'project' tour
    ↓
User sees tour → markTourStarted() called
    ↓
_hasSeenAnyTour = true in database
    ↓
User completes/skips tour → markComplete()/markSkipped()
    ↓
Future visits → NO auto-start (hasSeenAnyTour = true)
    ↓
Tours can only be triggered manually now
```

---

## Important Notes

### ⚠️ One-Time Auto-Start
Once `_hasSeenAnyTour` is set to `true`, tours will **NEVER** auto-start again. This is by design to prevent annoying returning users.

### 🔧 Manual Tour Triggers
To show tours after the first visit, you must:
1. Add a "Show Tour" button somewhere in your UI
2. Call `startTour()` from `useTourContext()`
3. Or create a custom implementation with `useTour()` hook

### 📝 Adding New Tours
To add a new tour:
1. Add tour ID to `TOUR_IDS` in `src/models/Tours/types.ts`
2. Add tour steps to `tourSteps` in `src/hooks/MultiPages/useTour.tsx`
3. Use `useTour({ tourId: TOUR_IDS.YOUR_NEW_TOUR, currentUser })` in your component

### 🎯 Tour Targeting
Tours use CSS selectors or IDs to target elements:
- Use stable class names or IDs
- Define constants in `src/lib/configs/general.config.ts`
- Example: `TOUR_TARGET_CONSTANTS.inviteTeamButton`

---

## Testing

### Test First-Time User Flow
1. Clear your user's `productTours` field in the database
2. Visit the Kanban board page
3. Tour should auto-start after 2 seconds

### Test Returning User Flow
1. Complete or skip a tour
2. Refresh the page
3. Tour should NOT auto-start

### Test Manual Trigger
1. Add a button that calls `startTour()`
2. Click the button
3. Tour should start regardless of `hasSeenAnyTour` status

---

## API Reference

### `useTourStatus({ tourId, currentUser })`
Returns:
- `shouldShowTour: boolean` - Whether this specific tour should be shown
- `hasSeenAnyTour: boolean` - Whether user has seen ANY tour before
- `markComplete: () => void` - Mark tour as completed
- `markSkipped: () => void` - Mark tour as skipped
- `markTourStarted: () => void` - Mark tour as started (sets _hasSeenAnyTour flag)

### `useTour({ tourId?, currentUser })`
Returns:
- `startTour: () => void` - Start the tour
- `startComponentTour: (componentId: string) => void` - Start a component-specific tour
- `endTour: () => void` - End the tour
- `isTourActive: () => boolean` - Check if tour is active
- `continueTourInModal: () => void` - Continue tour in a modal (for chained tours)
- `TourComponent: () => JSX.Element | null` - The tour component to render

---

## Migration

The migration has been applied:
```
npx prisma migrate dev --name add_product_tours_to_user_settings
```

Existing users will have `productTours = {}` by default, which means:
- `hasSeenAnyTour()` will return `false`
- They WILL see the tour on their next visit
- To prevent this, you may want to run a data migration to set `_hasSeenAnyTour: true` for all existing users

---

## Future Enhancements

### Suggested Improvements
1. **Admin Panel**: View tour completion statistics
2. **A/B Testing**: Test different tour variations
3. **Tour Analytics**: Track which tours are most helpful
4. **Tour Versioning**: Re-show tours when major features change
5. **Contextual Tours**: Show specific tours based on user actions
6. **Tour Completion Incentives**: Reward users for completing tours

---

## Support

For questions or issues:
1. Check the console logs - tours log their status extensively
2. Verify `productTours` field in database using Prisma Studio
3. Ensure tour target elements exist in the DOM
4. Check that `currentUser` is properly passed to hooks

---

**Implementation Date**: October 29, 2025
**Status**: ✅ Complete and Ready for Production


