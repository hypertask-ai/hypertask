import axios from "axios";
import type { AxiosResponse } from "axios";

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
