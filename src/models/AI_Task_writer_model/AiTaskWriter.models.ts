import { ITaskDetailEditMode } from "@/lib/contexts/TaskDetail/TaskProvider";
import { ITask } from "../model";
import type {
  TAiReasoningVariant,
  TModelProvider,
} from "@/lib/aiModelOptions";
import type { DictationCoordinator } from "@/lib/dictationCoordinator";

export interface IOption {
  display: string;
  action: string;
  loadingText?: string;
}

export interface ITaskWriterProperties {
  priority?: import("@/lib/constants/constants").IPrioritiesConstants;
  estimate?: import("@/lib/constants/constants").IEstimateConstants;
  tags?: import("../model").ILabel[];
  status?: import("@/models/CreateTaskModalModels/model").TSectionPayload;
}

export interface IAITaskWriterContainerProps {
  EscapeHandler: () => void;
  backgroundContent: string;
  AISaveHandler: (aiResponse: string, attachments?: any[]) => void;
  id: string;
  additionalContext?: string;
  defaultMode?: TAiMode;
  /** For Task Writer: callback when title/description/properties are extracted. Props optional for AcceptDescTitle. */
  returnTitleAndDescription: (
    title: string,
    description: string,
    props?: ITaskWriterProperties
  ) => void;
  returnUserInputHandler?: (input: string) => void;
  triggerAIWriterConfirm?: boolean;
  createTask?: boolean;
  attachments?: any[];
  toggleRecording?: (val: boolean) => void;
  isRecording?: boolean;
  dictationCoordinator?: DictationCoordinator;
  currentTask?: ITask;
  editMode?: ITaskDetailEditMode
}

export type TAiMode = "AiTaskWriter" | "WriteWithAI";

export interface IAiOption {
  display: string;
  type: TAiMode;
}

export interface TAiModal {
  id: string;
  source: TModelProvider;
  title: string;
  model: string;
  desc: string;
  reasoning?: TAiReasoningVariant;
}
