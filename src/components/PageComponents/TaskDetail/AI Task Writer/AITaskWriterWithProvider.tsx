import React from "react";
import { AITaskWriterProvider } from "@/lib/contexts/TaskDetail/AITaskWriterContext";
import AITaskWriterContainer from "./AITaskWriterContainer";
import { IAITaskWriterContainerProps } from "@/models/AI_Task_writer_model";
import { TAiMode } from "@/models/AI_Task_writer_model";
import { ITask, ILabel, type IProject } from "@/models/model";

interface AITaskWriterWithProviderProps extends Omit<IAITaskWriterContainerProps, 'backgroundContent' | 'additionalContext' | 'defaultMode' | 'attachments' | 'currentTask' | 'projectLabels' | 'projectSections'> {
  autoTrigger?: boolean;
  initialPrompt?: string;
  // Provider props
  defaultMode?: TAiMode;
  additionalContext?: string;
  attachments?: any[];
  backgroundContent?: string;
  currentTask?: ITask;
  /** Project labels for Task Writer - injected into prompt (Task Writer only) */
  projectLabels?: ILabel[];
  /** Project sections/columns for Task Writer - injected into prompt (Task Writer only) */
  projectSections?: { id?: number; section_title?: string }[];
  /** Destination board for global task creation. */
  project?: IProject;
  requestKind?: "manual" | "auto-description";
}

const AITaskWriterWithProvider: React.FC<AITaskWriterWithProviderProps> = ({
  // Provider props
  defaultMode = "WriteWithAI",
  additionalContext,
  attachments,
  backgroundContent = "",
  currentTask,
  projectLabels,
  projectSections,
  project,
  requestKind,
  // Container props
  ...containerProps
}) => {
  return (
    <AITaskWriterProvider
      defaultMode={defaultMode}
      additionalContext={additionalContext}
      attachments={attachments}
      description={backgroundContent}
      currentTask={currentTask}
      projectLabels={projectLabels}
      projectSections={projectSections}
      project={project}
      requestKind={requestKind}
    >
      <AITaskWriterContainer
        {...containerProps}
        backgroundContent={backgroundContent}
        projectLabels={projectLabels}
        projectSections={projectSections}
      />
    </AITaskWriterProvider>
  );
};

export default AITaskWriterWithProvider;
