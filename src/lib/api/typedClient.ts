import axios from "axios";
import type { AxiosResponse } from "axios";
import { z } from "zod";

import {
  boardDetailBodySchema,
  boardDetailResponseSchema,
  boardReadErrorSchema,
  compactTaskRelationsBodySchema,
  compactTaskRelationsResponseSchema,
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

// No frontend currently calls getAll. Describe the negotiated projection without
// adding another board request or opting existing callers into the server flag.
export const compactTaskRelationsRoute = {
  method: "POST",
  pathParams: z.undefined(),
  path: () => "/api/tasks/getAll",
  query: z.object({ compat: z.literal("htpr-6924") }),
  body: compactTaskRelationsBodySchema,
  success: compactTaskRelationsResponseSchema,
  validate: "deferred",
  errors: { 401: boardReadErrorSchema, 405: boardReadErrorSchema },
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
