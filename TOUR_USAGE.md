# Tour Feature - Usage Guide

> **Scope:** This guide covers the Joyride Kanban and Task Writer tours, which remain available. The keyboard-first tutorials at `/learn` and `/interactive-onboarding` are disabled under https://app.hypertask.ai/detail/project-15/5424.

## How It Works

The tour implementation follows this flow:

### 1. Welcome & Overview (Center Overlay)
- User clicks "Start Tour" button on the homepage
- First step shows a centered welcome message introducing the Kanban board

### 2. Show Columns/Sections
- Highlights the `.section-container` elements
- Explains that tasks are organized into sections/columns
- User can see all their workflow stages

### 3. Create Task Button
- Spotlights the `.create-new-task-button` (+ button)
- Uses `spotlightClicks: true` so user can actually click it
- Has `hideFooter: true` - no Next button, user MUST click the + button
- When clicked, tour automatically pauses and waits for modal

### 4. Create Task Modal Opens
- Modal component (`CreateTaskModalBody`) detects tour is active
- Automatically calls `continueTourInModal()` on mount
- Tour resumes with new steps specific to the modal

### 5. AI Features in Modal
- First highlights the title input field
- Then shows the description field
- Explains Ctrl+J (Cmd+J on Mac) shortcut for AI assistance
- Uses `spotlightClicks: true` so users can interact

## Code Structure

```
useTour.tsx (Hook)
├── tourSteps config
│   ├── project: [welcome, columns, create-button]
│   └── create-task-modal: [title, AI-description]
├── State management (run, steps, stepIndex)
├── loadStepsForRoute() - filters valid elements
├── loadStepsForComponent() - for modal tours
├── continueTourInModal() - bridges main → modal tour
└── TourComponent (Joyride wrapper)

TourContext.tsx (Provider)
├── Wraps useTour hook
├── Provides context to entire app
├── Renders TourComponent globally
└── Exports useTourContext() for consumers

Integration Points:
├── Providers.tsx - TourProvider wraps app
├── Homepage.tsx - "Start Tour" button
└── CreateTaskModalBody.tsx - Continues tour on mount
```

## Key Features

### Automatic Element Detection
- Tours automatically filter out steps with missing DOM elements
- Prevents errors if features are hidden or not loaded

### Context-Based State
- Tour state accessible anywhere via `useTourContext()`
- No prop drilling needed

### Smart Transitions
- Detects when user clicks create button
- Pauses main tour
- Resumes with modal-specific steps

### Keyboard Shortcuts Explained
- Shows Ctrl+K command palette
- Highlights Ctrl+J AI assistant
- Mentions other shortcuts (C for create, etc.)

## Customization

### Adding New Tours

Add to `tourSteps` in `useTour.tsx`:

```typescript
const tourSteps: TourStepsConfig = {
  // ... existing tours
  
  'my-new-tour': [
    {
      target: '.my-element',
      content: 'Description here',
      title: 'Step Title',
      placement: 'bottom',
      disableBeacon: true,
    },
  ],
};
```

### Starting Tours Programmatically

```typescript
const { startTour, startComponentTour } = useTourContext();

// Start main route-based tour
startTour();

// Start specific component tour
startComponentTour('shortcuts');
```

### Styling

Customize in `TourComponent` return in `useTour.tsx`:

```typescript
styles={{
  options: {
    primaryColor: '#8b5cf6', // Purple theme
    zIndex: 10000,
  },
  tooltip: {
    borderRadius: 8,
  },
  // ... more styles
}}
```

## Element Classes Required

Make sure these classes exist in your components:

- `.section-container` - Section/column wrapper
- `.create-new-task-button` - The + button to create tasks
- `#title-input-modal` - Task title input
- `#create-task-tiptap-description` - Description editor
- `#sectionsContainer` - Main sections container

## Testing the Tour

1. Run the app: `npm run dev`
2. Navigate to a project board
3. Click "Start Tour" button
4. Follow the steps:
   - Welcome → Next
   - Columns → Next
   - Create Button → Click the + button
   - Modal opens → Tour continues
   - AI Features → Finish

## Troubleshooting

### Tour doesn't start
- Check console for "No tour found for route" warnings
- Verify the route key matches `tourSteps` config
- Check DOM elements exist before tour starts

### Steps are skipped
- Element might not be in DOM yet
- Check console for "Element not found" warnings
- Add delays or ensure elements render before tour

### Tour doesn't continue in modal
- Verify `continueTourInModal()` is called in modal's useEffect
- Check `isTourActive()` returns true
- Look for console logs: "🎯 Continuing tour in create task modal"

## Future Enhancements

- [ ] Add tour for keyboard shortcuts (already defined in steps)
- [ ] Add tour for task detail page
- [ ] Persist tour completion status in user preferences
- [ ] Add "Skip Tour" that remembers preference
- [ ] Add tour progress indicator
- [ ] Add tour for filters and views
- [ ] Add tour for collaboration features
