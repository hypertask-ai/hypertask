import axios from "axios";
import type { AxiosResponse } from "axios";
import axiosClient from "@/utils/axiosClient";
import * as taskWrites from "@/lib/api/contracts/taskWrites";
import { z } from "zod";

import {
  boardDetailBodySchema,
  boardDetailResponseSchema,
  boardReadErrorSchema,
  descriptionVersionsPathSchema,
  descriptionVersionsResponseSchema,
  taskCycleQuerySchema,
  taskCycleResponseSchema,
} from "@/lib/api/contracts/taskReads";
import type { BoardDetailBody, TaskCycleQuery } from "@/lib/api/contracts/taskReads";
import { apiReadErrorSchema } from "@/lib/api/contracts/settingsReads";

import { boardMemoryRoute } from "@/lib/constants/APIRouteConstants";
import {
  boardMemoryResponseSchema,
  skillsListResponseSchema,
} from "@/lib/api/contracts/settingsReads";
import type {
  BoardMemoryResponse,
  SkillsListQuery,
  SkillsListResponse,
} from "@/lib/api/contracts/settingsReads";

export async function getBoardMemory(projectId: number): Promise<AxiosResponse<BoardMemoryResponse>> {
  const response = await axios.get<BoardMemoryResponse>(boardMemoryRoute, {
    params: { projectId },
    headers: { "X-Hypertask-Client": "htpr-6925" },
  });
  const result = boardMemoryResponseSchema.safeParse(response.data);
  if (result.success) {
    response.data = result.data;
  } else {
    // Keep legacy parsed JSON on drift so validation alone cannot make a working UI fail.
    console.warn("Typed API contract mismatch: getBoardMemory", result.error.issues);
  }
  return response;
}

export async function listSkills(params: SkillsListQuery): Promise<AxiosResponse<SkillsListResponse>> {
  const response = await axios.get<SkillsListResponse>("/api/ai/skills", {
    params,
    headers: { "X-Hypertask-Client": "htpr-6925" },
  });
  const result = skillsListResponseSchema.safeParse(response.data);
  if (result.success) {
    response.data = result.data;
  } else {
    // Keep legacy parsed JSON on drift so validation alone cannot make a working UI fail.
    console.warn("Typed API contract mismatch: listSkills", result.error.issues);
  }
  return response;
}

// Descriptors describe the wire contract only. Concrete readers keep their original
// transport and rejection semantics instead of imposing a shared request wrapper.
export type ReadRouteDescriptor<Path extends z.ZodType = z.ZodType> = {
  method: "GET" | "POST";
  pathParams: Path;
  path: (params: z.input<Path>) => string;
  query: z.ZodType;
  body: z.ZodType;
  success: z.ZodType;
  validate?: "sync" | "deferred";
  errors: Record<number, z.ZodType>;
};

export const descriptionVersionsRoute = {
  method: "GET",
  pathParams: descriptionVersionsPathSchema,
  path: ({ taskId }) => `/api/tasks/${taskId}/description-versions`,
  query: z.undefined(),
  body: z.undefined(),
  success: descriptionVersionsResponseSchema,
  errors: { 400: apiReadErrorSchema, 401: apiReadErrorSchema, 404: apiReadErrorSchema, 500: apiReadErrorSchema },
} satisfies ReadRouteDescriptor<typeof descriptionVersionsPathSchema>;

export const taskCycleRoute = {
  method: "GET",
  pathParams: z.undefined(),
  path: () => "/api/tasks/cycle",
  query: taskCycleQuerySchema,
  body: z.undefined(),
  success: taskCycleResponseSchema,
  errors: { 400: apiReadErrorSchema, 401: apiReadErrorSchema, 404: apiReadErrorSchema, 500: apiReadErrorSchema },
} satisfies ReadRouteDescriptor;

export const boardDetailRoute = {
  method: "POST",
  pathParams: z.undefined(),
  path: () => "/api/projects/boardTasks",
  query: z.undefined(),
  body: boardDetailBodySchema,
  success: boardDetailResponseSchema,
  validate: "deferred",
  errors: { 400: boardReadErrorSchema, 401: boardReadErrorSchema, 403: boardReadErrorSchema, 405: boardReadErrorSchema },
} satisfies ReadRouteDescriptor;

function validateRead<Schema extends z.ZodType>(name: string, schema: Schema, data: z.output<Schema>, validate: ReadRouteDescriptor["validate"] = "sync"): z.output<Schema> {
  if (validate === "deferred") {
    // Large answers are diagnostic only; never delay board hydration or replace its data.
    if (typeof window !== "undefined") {
      const check = () => { validateRead(name, schema, data); };
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(check, { timeout: 1000 });
      } else {
        window.setTimeout(check, 0);
      }
    }
    return data;
  }
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  // Match slice 1: drift is diagnostic, never a new user-visible failure.
  console.warn(`Typed API contract mismatch: ${name}`, result.error.issues);
  return data;
}

export async function getDescriptionVersions(taskId: number, signal?: AbortSignal) {
  const route = descriptionVersionsRoute;
  const response = await axios.get<z.output<typeof route.success>>(route.path({ taskId }), {
    signal,
    headers: { "X-Hypertask-Client": "htpr-6925" },
  });
  response.data = validateRead("getDescriptionVersions", route.success, response.data);
  return response;
}

export async function getTaskCycle(params: TaskCycleQuery, signal?: AbortSignal) {
  const route = taskCycleRoute;
  const query = new URLSearchParams({ taskId: String(params.taskId) });
  if (params.query) query.set("query", params.query);
  if (params.cursor !== undefined) query.set("cursor", String(params.cursor));
  const response = await fetch(`${route.path()}?${query}`, {
    signal,
    headers: { "X-Hypertask-Client": "htpr-6925" },
  });
  if (!response.ok) throw new Error("Unable to load cycles");
  return validateRead("getTaskCycle", route.success, await response.json());
}

export async function getBoardDetail(body: BoardDetailBody, signal?: AbortSignal) {
  const route = boardDetailRoute;
  const response = await axios.post<z.output<typeof route.success>>(route.path(), body, {
    signal,
    headers: { "X-Hypertask-Client": "htpr-6925" },
  });
  response.data = validateRead("getBoardDetail", route.success, response.data, route.validate);
  return response;
}

// Writes keep each caller's transport and HTTP rejection behavior.
type WriteRouteDescriptor = Omit<ReadRouteDescriptor, "method"> & { method: "POST" | "PUT" };

export const moveTaskRoute = {
  method: "PUT",
  pathParams: z.undefined(),
  path: () => "/api/tasks/moveTask",
  query: z.undefined(),
  body: taskWrites.moveTaskBodySchema,
  success: taskWrites.moveTaskResponseSchema,
  validate: "deferred",
  errors: { 400: taskWrites.taskWriteErrorSchema, 401: taskWrites.taskWriteErrorSchema, 403: taskWrites.taskWriteErrorSchema, 404: taskWrites.taskWriteErrorSchema, 405: taskWrites.taskWriteErrorSchema, 409: taskWrites.taskWriteErrorSchema, 500: taskWrites.taskWriteErrorSchema },
} satisfies WriteRouteDescriptor;

export const taskDueDateRoute = {
  method: "POST",
  pathParams: z.undefined(),
  path: () => "/api/tasks/setDueDate",
  query: z.undefined(),
  body: taskWrites.dueDateBodySchema,
  success: taskWrites.taskPropertyResponseSchema,
  validate: "deferred",
  errors: { 400: taskWrites.taskWriteErrorSchema, 401: taskWrites.taskWriteErrorSchema, 403: taskWrites.taskWriteErrorSchema, 404: taskWrites.taskWriteErrorSchema, 405: taskWrites.taskWriteErrorSchema, 409: taskWrites.taskWriteErrorSchema, 500: taskWrites.taskWriteErrorSchema },
} satisfies WriteRouteDescriptor;

export const taskStartDateRoute = {
  method: "POST",
  pathParams: z.undefined(),
  path: () => "/api/tasks/setStartDate",
  query: z.undefined(),
  body: taskWrites.startDateBodySchema,
  success: taskWrites.taskPropertyResponseSchema,
  validate: "deferred",
  errors: { 400: taskWrites.taskWriteErrorSchema, 401: taskWrites.taskWriteErrorSchema, 403: taskWrites.taskWriteErrorSchema, 404: taskWrites.taskWriteErrorSchema, 405: taskWrites.taskWriteErrorSchema, 409: taskWrites.taskWriteErrorSchema, 500: taskWrites.taskWriteErrorSchema },
} satisfies WriteRouteDescriptor;

export const taskWaitingOnRoute = {
  method: "POST",
  pathParams: z.undefined(),
  path: () => "/api/tasks/waiting-on",
  query: z.undefined(),
  body: taskWrites.waitingOnBodySchema,
  success: taskWrites.waitingOnResponseSchema,
  errors: { 400: taskWrites.taskWriteErrorSchema, 401: taskWrites.taskWriteErrorSchema, 403: taskWrites.taskWriteErrorSchema, 404: taskWrites.taskWriteErrorSchema, 405: taskWrites.taskWriteErrorSchema, 409: taskWrites.taskWriteErrorSchema, 500: taskWrites.taskWriteErrorSchema },
} satisfies WriteRouteDescriptor;

export const taskPriorityRoute = {
  method: "POST",
  pathParams: z.undefined(),
  path: () => "/api/priority/setPriority",
  query: z.undefined(),
  body: taskWrites.priorityBodySchema,
  success: taskWrites.priorityResponseSchema,
  errors: { 400: taskWrites.taskWriteErrorSchema, 401: taskWrites.taskWriteErrorSchema, 403: taskWrites.taskWriteErrorSchema, 404: taskWrites.taskWriteErrorSchema, 405: taskWrites.taskWriteErrorSchema, 409: taskWrites.taskWriteErrorSchema, 500: taskWrites.taskWriteErrorSchema },
} satisfies WriteRouteDescriptor;

export const taskEstimateRoute = {
  method: "POST",
  pathParams: z.undefined(),
  path: () => "/api/estimate/setEstimate",
  query: z.undefined(),
  body: taskWrites.estimateBodySchema,
  success: taskWrites.estimateResponseSchema,
  errors: { 400: taskWrites.taskWriteErrorSchema, 401: taskWrites.taskWriteErrorSchema, 403: taskWrites.taskWriteErrorSchema, 404: taskWrites.taskWriteErrorSchema, 405: taskWrites.taskWriteErrorSchema, 409: taskWrites.taskWriteErrorSchema, 500: taskWrites.taskWriteErrorSchema },
} satisfies WriteRouteDescriptor;

export const taskAssigneeRoute = {
  method: "POST",
  pathParams: z.undefined(),
  path: () => "/api/assignees/assign",
  query: z.undefined(),
  body: taskWrites.assigneeBodySchema,
  success: taskWrites.assigneeResponseSchema,
  errors: { 400: taskWrites.taskWriteErrorSchema, 401: taskWrites.taskWriteErrorSchema, 403: taskWrites.taskWriteErrorSchema, 404: taskWrites.taskWriteErrorSchema, 405: taskWrites.taskWriteErrorSchema, 409: taskWrites.taskWriteErrorSchema, 500: taskWrites.taskWriteErrorSchema },
} satisfies WriteRouteDescriptor;

export const taskLabelRoute = {
  method: "POST",
  pathParams: z.undefined(),
  path: () => "/api/labels/assignLabel",
  query: z.undefined(),
  body: taskWrites.labelBodySchema,
  success: taskWrites.labelResponseSchema,
  errors: { 400: taskWrites.taskWriteErrorSchema, 401: taskWrites.taskWriteErrorSchema, 403: taskWrites.taskWriteErrorSchema, 404: taskWrites.taskWriteErrorSchema, 405: taskWrites.taskWriteErrorSchema, 409: taskWrites.taskWriteErrorSchema, 500: taskWrites.taskWriteErrorSchema },
} satisfies WriteRouteDescriptor;

export async function setTaskDueDate(body: taskWrites.DueDateBody) {
  const route = taskDueDateRoute;
  const response = await axios.post<z.output<typeof route.success>>(route.path(), body, {
    headers: { "X-Hypertask-Client": "htpr-6925" },
  });
  response.data = validateRead("setTaskDueDate", route.success, response.data, route.validate);
  return response;
}

export async function setTaskStartDate(body: taskWrites.StartDateBody) {
  const route = taskStartDateRoute;
  const response = await axios.post<z.output<typeof route.success>>(route.path(), body, {
    headers: { "X-Hypertask-Client": "htpr-6925" },
  });
  response.data = validateRead("setTaskStartDate", route.success, response.data, route.validate);
  return response;
}

export async function setTaskWaitingOn(body: taskWrites.WaitingOnBody) {
  const route = taskWaitingOnRoute;
  const response = await axios.post<z.output<typeof route.success>>(route.path(), body, {
    headers: { "X-Hypertask-Client": "htpr-6925" },
  });
  response.data = validateRead("setTaskWaitingOn", route.success, response.data);
  return response;
}

export async function setTaskPriority(body: taskWrites.PriorityBody) {
  const route = taskPriorityRoute;
  const response = await axios.post<z.output<typeof route.success>>(route.path(), body, {
    headers: { "X-Hypertask-Client": "htpr-6925" },
  });
  response.data = validateRead("setTaskPriority", route.success, response.data);
  return response;
}

export async function setTaskEstimate(body: taskWrites.EstimateBody) {
  const route = taskEstimateRoute;
  const response = await axios.post<z.output<typeof route.success>>(route.path(), body, {
    headers: { "X-Hypertask-Client": "htpr-6925" },
  });
  response.data = validateRead("setTaskEstimate", route.success, response.data);
  return response;
}

export async function assignTaskUser(body: taskWrites.AssigneeBody) {
  const route = taskAssigneeRoute;
  const response = await axios.post<z.output<typeof route.success>>(route.path(), body, {
    headers: { "X-Hypertask-Client": "htpr-6925" },
  });
  response.data = validateRead("assignTaskUser", route.success, response.data);
  return response;
}

export async function assignTaskLabel(body: taskWrites.LabelBody) {
  const route = taskLabelRoute;
  const response = await axiosClient.post<z.output<typeof route.success>>(route.path().slice(4), body, {
    headers: { "X-Hypertask-Client": "htpr-6925" },
  });
  response.data = validateRead("assignTaskLabel", route.success, response.data);
  return response;
}

export async function moveTask(body: taskWrites.MoveTaskBody) {
  return fetch(moveTaskRoute.path(), {
    method: moveTaskRoute.method,
    headers: { "Content-Type": "application/json", "X-Hypertask-Client": "htpr-6925" },
    body: JSON.stringify(body),
  });
}

// Native-fetch callers keep their distinct status checks and JSON error handling.
export async function readMoveTaskResponse(response: Response): Promise<z.output<typeof moveTaskRoute.success>> {
  return validateRead("moveTask", moveTaskRoute.success, await response.json(), moveTaskRoute.validate);
}
