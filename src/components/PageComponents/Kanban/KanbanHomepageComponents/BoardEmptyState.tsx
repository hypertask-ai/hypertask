"use client";

import React from "react";
import { cn } from "@/utils/undoActions/helperFuncs";
import { EmptyStateCause, EmptyStateDetection } from "@/utils/helperFunctions/Views/BoardEmptyStateHelper";
import { useKanbanModalStatesContext } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useFilters from "@/hooks/Homepage/Filters/useFilters";
import { showCommandsAtom } from "@/store";
import { useSetRecoilState } from "@/lib/state";
import { CommandMode } from "@/models/enums";
import KBDElement from "@/components/Common/kbd";

interface BoardEmptyStateProps {
  detection: EmptyStateDetection;
}

/**
 * BoardEmptyState Component
 * 
 * Displays contextual, actionable messages when a board appears empty.
 * Detects the root cause and provides specific guidance to resolve it.
 */
export const BoardEmptyState: React.FC<BoardEmptyStateProps> = ({
  detection,
}) => {
  const { toggleManageViewsModal } = useKanbanModalStatesContext();
  const { toggleCreateTaskGlobally } = useHypertasksRecoilStates();
  const { resetFilters } = useFilters();
  const isApple = useDeviceContext();
  const setShowCommands = useSetRecoilState(showCommandsAtom);
  const toggleManageColumnsModal = () =>
    setShowCommands({ show: true, mode: CommandMode.ManageColumn });
  const openAddColumn = () =>
    setShowCommands({ show: true, mode: CommandMode.AddColumn });
  const renderMessage = () => {
    switch (detection.cause) {
      case "no_columns":
        return {
          title: "Create your first column",
          description:
            "Get started by creating a column to organize your tasks.",
          primaryAction: {
            label: "Create Column",
            onClick: openAddColumn,
            shortcut: "Press C to create a column",
            keyboard: ["C"],
          },
        };

      case "all_columns_hidden":
        return {
          title: "All columns are hidden",
          description:
            "Your column visibility settings are hiding all columns. Show columns in View settings to see your board.",
          primaryAction: {
            label: "Manage Views",
            onClick: () => toggleManageViewsModal(),
            shortcut: "Press Shift+V to manage views",
            keyboard: ["Shift", "V"],
          },
        };

      case "filters_hiding_all":
        return {
          title: "Your filters are hiding all tasks",
          description:
            "The active filters don't match any tasks. Clear or adjust your filters to see tasks.",
          primaryAction: {
            label: "Clear Filters",
            onClick: () => {
              resetFilters();
            },
            shortcut: "Press Shift+F to manage filters",
            keyboard: ["Shift", "F"],
          },
        };

      case "empty_sections_hidden":
        return {
          title: "All columns are empty and hidden",
          description:
            "Your board has empty columns that are hidden. Create a task or show empty columns to get started.",
          primaryAction: {
            label: "Create Task",
            onClick: () => toggleCreateTaskGlobally(),
            shortcut: `Press ${isApple ? "⌘" : "Ctrl"}+K to create a task`,
            keyboard: ["C"],
          },
          secondaryAction: {
            label: "Show Empty Columns",
            onClick: () => toggleManageColumnsModal(),
            shortcut: `Press ${isApple ? "⌘" : "Ctrl"}+K to manage columns`,
            keyboard: ["⌘", "K"],
          },
        };

      case "actually_empty":
        return {
          title: "Create your first task",
          description:
            "Get started by creating your first task to organize your work.",
          primaryAction: {
            label: "Create Task",
            onClick: () => toggleCreateTaskGlobally(),
            shortcut: `Press ${isApple ? "⌘" : "Ctrl"}+K to create a task`,
            keyboard: ["C"],
          },
        };

      default:
        return {
          title: "Board is empty",
          description: "Create a task to get started.",
          primaryAction: {
            label: "Create Task",
            onClick: () => toggleCreateTaskGlobally(),
            shortcut: `Press ${isApple ? "⌘" : "Ctrl"}+K to create a task`,
            keyboard: ["C"],
          },
        };
    }
  };

  const message = renderMessage();

  return (
    <div
      className={cn(
        "w-full flex flex-col items-center justify-center",
        "py-16 px-8",
        "min-h-[400px]"
      )}
    >
      <div
        className={cn(
          "max-w-md w-full",
          "text-center",
          "space-y-6"
        )}
      >
        {/* Title */}
        <h2
          className={cn(
            "text-heading font-semibold",
            "text-white"
          )}
        >
          {message.title}
        </h2>

        {/* Description */}
        <p
          className={cn(
            "text-emphasis",
            "text-text-light-gray",
            "leading-relaxed"
          )}
        >
          {message.description}
        </p>

        {/* Actions */}
        <div className="flex flex-col items-center gap-4">
          {/* Primary CTA */}
          <button
            onClick={message.primaryAction.onClick}
            className={cn(
              "px-3 py-2",
              "bg-purple-900",
              "text-white font-medium",
              "rounded",
              "transition-colors duration-150",
              "hover:bg-purple-800",
              "shadow-lg hover:shadow-xl"
            )}
          >
            {message.primaryAction.label} {
              message.primaryAction.keyboard && (
                <KBDElement content={message.primaryAction.keyboard.join(" + ")} />
              )
            }
          </button>

          {/* Secondary CTA (if exists) */}
          {message.secondaryAction && (
            <button
              onClick={message.secondaryAction.onClick}
              className={cn(
                "px-3 py-2",
                "bg-transparent",
                "text-text-light-gray",
                "!border-thin border-border-light-gray-thin",
                "font-medium",
                "rounded",
                "transition-colors duration-150",
                "hover:bg-white/5",
                "hover:text-white"
              )}
            >
              {message.secondaryAction.label}
              {
                message.secondaryAction.keyboard && (
                  <KBDElement content={message.secondaryAction.keyboard.join(" + ")} />
                )
              }
            </button>
          )}

        
        </div>
      </div>
    </div>
  );
};

export default BoardEmptyState;
