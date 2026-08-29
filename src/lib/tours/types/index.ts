/**
 * Tour Status Tracking Types
 */

export type TourStatus = {
  completed: boolean;
  completedAt?: string;
  skipped?: boolean;
  lastSeenAt?: string;
};

export type ProductToursData = {
  _hasSeenAnyTour?: boolean;
} & Record<string, TourStatus | boolean | undefined>;

/**
 * Tour IDs that match the tourSteps keys in config/steps.ts
 */
export const TOUR_IDS = {
  PROJECT: 'project',
  CREATE_TASK_MODAL: 'create-task-modal',
  SHORTCUTS: 'shortcuts',
  TASK_DETAIL: 'task-detail',
  TASK_WRITER: 'task-writer',
} as const;

export type TourId = (typeof TOUR_IDS)[keyof typeof TOUR_IDS];


