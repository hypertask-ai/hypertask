import globalConstants from "@/lib/constants";
import {
  IEstimateConstants,
  IPrioritiesConstants,
} from "@/lib/constants/constants";
import { IParentTask } from "@/models/CreateTaskModalModels/model";
import { IAgent, ILabel, ITask, IUser } from "@/models/model";
import {
  parseTaskCreateServerTiming,
  recordTaskCreateResponse,
  type TaskCreateTraceScope,
} from "@/lib/analytics/productPerformance";
import axios from "axios";
import { createSerializableTaskPayload } from "../createTaskPayload";

interface IProps {
  userId: number;
  projectId: number;
  projectIdentifier: string;
  title: string;
  ranking?: string;
  sectionId: number;
  section_title: string;
  priority?: IPrioritiesConstants;
  estimate?: IEstimateConstants;
  dueDate?: Date;
  startDate?: Date;
  tags?: ILabel[];
  parentTask?: IParentTask;
  assignees: (IUser | IAgent)[];
  createTaskFromComment?: { task: ITask; commentIndex: number };
}

const recordCreateResponse = ({
  userId,
  projectId,
  startedAt,
  result,
  responseStatus,
  serverTimingHeader,
  traceScope,
}: {
  userId: number;
  projectId: number;
  startedAt: number;
  result: "success" | "error";
  responseStatus: number;
  serverTimingHeader: unknown;
  traceScope: TaskCreateTraceScope | null;
}) => {
  if (typeof performance === "undefined") return;
  recordTaskCreateResponse({
    accountId: userId,
    projectId,
    networkDurationMs: performance.now() - startedAt,
    responseStatus,
    serverTimings: parseTaskCreateServerTiming(
      typeof serverTimingHeader === "string" ? serverTimingHeader : undefined,
    ),
    result,
    scope: traceScope,
  });
};

const createNewTaskGloballyAPIHandler = async (
  props: IProps,
  traceScope: TaskCreateTraceScope | null = null,
) => {
  const startedAt = typeof performance === "undefined" ? 0 : performance.now();
  try {
    const taskRequest = {
      ...props,
      fullScreenTask: true,
    };
    const payload = createSerializableTaskPayload(taskRequest);
    const omittedFields = Object.entries(taskRequest)
      .filter(
        ([key, value]) =>
          value !== undefined && !Object.prototype.hasOwnProperty.call(payload, key)
      )
      .map(([key]) => key);
    if (omittedFields.length > 0) {
      console.warn(
        "Task creation omitted non-serializable fields:",
        omittedFields
      );
    }
    const response = await axios.post(
      globalConstants.createNewTaskGloballyRoute,
      payload
    );
    recordCreateResponse({
      userId: props.userId,
      projectId: props.projectId,
      startedAt,
      result: response.status === 200 ? "success" : "error",
      responseStatus: response.status,
      serverTimingHeader: response.headers["server-timing"],
      traceScope,
    });
    if (response.status === 406)
      throw {
        message: "Something went wrong! Perhaps the board has no section.",
      };
    else if (response.status === 200) {
      return { resposne: response.data, error: false };
    }
  } catch (error) {
    recordCreateResponse({
      userId: props.userId,
      projectId: props.projectId,
      startedAt,
      result: "error",
      responseStatus: axios.isAxiosError(error)
        ? (error.response?.status ?? 0)
        : 0,
      serverTimingHeader: axios.isAxiosError(error)
        ? error.response?.headers["server-timing"]
        : undefined,
      traceScope,
    });
    console.log("🚀 ~ createNewTaskGloballyAPIHandler ~ error:", error);
    return { error: true, ErrorMessage: error };
  }
};
export default createNewTaskGloballyAPIHandler;
