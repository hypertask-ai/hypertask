/**
 * Tours Module
 * 
 * Centralized module for all tour-related functionality.
 * Provides product tours using react-joyride for guiding users through features.
 * 
 * @module tours
 */

// Types
export * from './types';

// Configuration
export { tourSteps } from './config/steps';

// Hooks
export { useTour } from './hooks/useTour';
export { useTourStatus } from './hooks/useTourStatus';

// Context
export { TourProvider, useTourContext } from './context/TourContext';

/**
 * API Routes (must remain in pages/api for Next.js routing)
 * 
 * - POST /api/tours/update - Update tour completion status
 * 
 * Located at: src/pages/api/tours/update.ts
 */
