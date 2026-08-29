// Type-only: a value import here would pull react-joyride's 102 KB runtime back
// into the initial chunk, defeating the dynamic import in useTour.tsx (HTPR-4508).
import type { Step } from 'react-joyride';
import { CLASS_NAME_CONSTANTS, TOUR_TARGET_CONSTANTS } from '@/lib/configs/general.config';
import React from 'react';
import KBDElement from '@/components/Common/kbd';
import { useDeviceContext } from '@/lib/contexts/deviceContext';
export type TourStepsConfig = {
  [key: string]: Step[];
};

/**
 * Helper component to display keyboard shortcuts nicely
 */
const KbdShortcut: React.FC<{ keys: string[] }> = ({ keys }) => (
  <span className="inline-flex items-center gap-1">
    {keys.map((key, index) => (
      <React.Fragment key={index}>
        {index > 0 && <span className="text-white-black opacity-50">+</span>}
        <kbd className="px-2 py-1 text-meta font-semibold bg-active-elementBg rounded border border-border-light-gray-thin text-white-black-inverted">
          {key}
        </kbd>
      </React.Fragment>
    ))}
  </span>
);

const CommandModifier = () => {
  const isApple = useDeviceContext();
  return <KBDElement content={isApple ? 'Cmd' : 'Ctrl'} />;
};

/**
 * Tour step definitions organized by tour ID
 * Each tour can have multiple steps that guide users through features
 */
export const tourSteps: TourStepsConfig = {
  // Main Kanban Board Tour
  project: [
    {
      target: TOUR_TARGET_CONSTANTS.inviteTeamButton,
      content: (
        <div className="space-y-2">
          <p>Invite your team members and collaborate together. Click here to add more people to your project.</p>
        </div>
      ),
      title: 'Invite Team Members',
      placement: 'bottom',
      spotlightClicks: false,
      disableBeacon: true,
      event: "hover",
    },
    {
      target: TOUR_TARGET_CONSTANTS.inboxButton,
      content: (
        <div className="block space-x-2">
          <span>Click the inbox button to go to your inbox, or use the keyboard shortcut: 
            </span>
            <KBDElement  content={'G'} />
            <span className="text-white-black font-semibold">then</span>
            <KBDElement content={'I'} />
          
        </div>
      ),
      title: "Inbox",
      placement: "bottom",
      disableBeacon: true,
      spotlightClicks: false,
      floaterProps: {
        offset: 15,
      },
    },
    {
      target: TOUR_TARGET_CONSTANTS.BOTTOM_HTC,
      content: (
        <div className="block space-x-2">
          <span>Click the HTC button to open the Hypertask Command Center, or use the keyboard shortcut:
            </span>
            <CommandModifier />
              <span className="text-white-black font-semibold">+</span>
            <KBDElement content={'K'} />
        </div>
      ),
      title: 'HTC Menu',
      placement: 'bottom',
      disableBeacon: true,
      spotlightClicks: true,
      showProgress: true,
      hideFooter: true,
      event: "click",
    },
  ],

  // Create Task Modal Tour - triggered when modal opens
  'create-task-modal': [
    {
      target: TOUR_TARGET_CONSTANTS.titleInputModal,
      content: 'This is where you enter your task title. But here\'s the magic... ✨',
      title: 'Task Creation',
      placement: 'bottom',
      disableBeacon: true,
      showSkipButton: true,
    },
    {
      target: TOUR_TARGET_CONSTANTS.descriptionContainerCreateTaskModal,
      content: (
        <div className="space-y-2">
          <p>Great! Now let&apos;s use AI to write your task description.</p>
          <p className="text-content opacity-90">Click in the description field and press <CommandModifier /> + <KBDElement content={'J'} /> to open the AI Task Writer.</p>
        </div>
      ),
      title: 'AI-Powered Task Writing',
      placement: 'top',
      disableBeacon: true,
      spotlightClicks: true,
    },
  ],
  
  // Keyboard Shortcuts Tour
  shortcuts: [
    {
      target: 'body',
      content: 'Hypertasks is designed for speed! Here are some essential keyboard shortcuts.',
      title: 'Keyboard Shortcuts ⌨️',
      disableBeacon: true,
      placement: 'center',
    },
    {
      target: 'body',
      content: 'Use J/K to move between tasks, H/L to move between columns. Add Shift to move the task itself (SHIFT+J/K/H/L).',
      title: 'Navigation Shortcuts',
      placement: 'center',
    },
    {
      target: 'body',
      content: 'Press "A" to assign users, "P" for priority, "L" for labels, "S" for size, and "E" to archive notifications.',
      title: 'Quick Actions',
      placement: 'center',
    },
  ],

  // Task Detail Tour
  'task-detail': [
    {
      target: '.task-card',
      content: 'Click on any task or press Enter to view its details, add comments, subtasks, and more.',
      title: 'Task Details',
      placement: 'right',
    },
    {
      target: '.task-card',
      content: 'Set priority, assign users, add labels, set due dates, and estimates. Use keyboard shortcuts for faster workflow!',
      title: 'Task Actions',
      placement: 'right',
    },
  ],

  // Task Writer Magic Tour - Interactive 3-step tour
  'task-writer': [
    {
      target: TOUR_TARGET_CONSTANTS.createNewTaskButton,
      content: (
        <div className="space-y-2">
          <p>Let&apos;s create your first AI-powered task in 10 seconds!</p>
          <p className="text-content opacity-90">Press <KBDElement content={'C'} /> or click the Plus Icon to create a new task.</p>
        </div>
      ),
      title: 'Task Writer',
      placement: 'right-start',
      disableBeacon: true,
      spotlightClicks: true,
      showProgress: true,
    },
    {
      target: TOUR_TARGET_CONSTANTS.createTaskDescription,
      content: (
        <div className="space-y-2">
          <p>Great! Now let&apos;s use AI to write your task description.</p>
          <p className="text-content opacity-90">Click in the description field and press <CommandModifier /> + <KBDElement content={'J'} /> to open the AI Task Writer.</p>
        </div>
      ),
    }
  ]
};
