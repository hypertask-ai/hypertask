import type { AI_Skill } from "@prisma/client";
import type { z } from "zod";
import type { getBoardMemoryState } from "@/app/api/ai/_lib/boardMemory";
import { getBoardMemory, listSkills } from "@/lib/api/typedClient";
import {
  boardMemoryResponseSchema,
  skillsListResponseSchema,
  skillResponseSchema,
} from "@/lib/api/contracts/settingsReads";
import type { SkillsListQuery } from "@/lib/api/contracts/settingsReads";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type JsonSkill = Omit<AI_Skill, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };
type MemoryProducer = Awaited<ReturnType<typeof getBoardMemoryState>>;
type MemoryContract = z.output<typeof boardMemoryResponseSchema>;
type MemoryKnown = {
  enabled: MemoryContract["enabled"];
  memories: Pick<MemoryContract["memories"][number], keyof MemoryProducer["memories"][number]>[];
};

export type MemoryData = Assert<Equal<Awaited<ReturnType<typeof getBoardMemory>>["data"], MemoryContract>>;
export type SkillsData = Assert<Equal<Awaited<ReturnType<typeof listSkills>>["data"], z.output<typeof skillsListResponseSchema>>>;
export type MemoryProducerParity = Assert<Equal<MemoryKnown, MemoryProducer>>;
export type SkillProducerParity = Assert<Equal<Pick<z.output<typeof skillResponseSchema>, keyof JsonSkill>, Pick<JsonSkill, keyof JsonSkill>>>;
export type QueryIsInferred = Assert<Equal<Parameters<typeof listSkills>[0], SkillsListQuery>>;

void getBoardMemory(15);
void listSkills({ projectId: 15, teamId: "team-1" });
// @ts-expect-error memory callers cannot pass string IDs
void getBoardMemory("15");
// @ts-expect-error required board ID
void getBoardMemory();
// @ts-expect-error unknown skills query field
void listSkills({ scope: "user" });
// @ts-expect-error no nullable team ID on the wire
void listSkills({ teamId: null });
// @ts-expect-error caller cannot choose a response type
void listSkills<{ arbitrary: true }>({});
// @ts-expect-error caller cannot choose a response type
void getBoardMemory<{ arbitrary: true }>(15);
// @ts-expect-error serialized skill dates are strings
const invalidDate: z.output<typeof skillResponseSchema>["createdAt"] = new Date();
void invalidDate;

import type { Cycle, DocVersion, Task } from "@prisma/client";
import { getDescriptionVersions, getTaskCycle, getBoardDetail, descriptionVersionsRoute, taskCycleRoute, boardDetailRoute, compactTaskRelationsRoute } from "@/lib/api/typedClient";
import { descriptionVersionsResponseSchema, taskCycleResponseSchema, boardDetailResponseSchema, cycleResponseSchema, taskRelationSchema } from "@/lib/api/contracts/taskReads";

type JsonCycle = Omit<Cycle, "startDate" | "endDate" | "rolledOverAt" | "createdAt"> & { startDate: string; endDate: string; rolledOverAt: string | null };
type JsonVersion = Pick<DocVersion, "id" | "version" | "contentText" | "authorId" | "agentId"> & { createdAt: string };
type RelationFields = "id" | "uniqueIndex" | "ticketNumber" | "title" | "status" | "projectId" | "sectionId";
export type VersionsData = Assert<Equal<Awaited<ReturnType<typeof getDescriptionVersions>>["data"], z.output<typeof descriptionVersionsResponseSchema>>>;
export type CycleData = Assert<Equal<Awaited<ReturnType<typeof getTaskCycle>>, z.output<typeof taskCycleResponseSchema>>>;
export type BoardData = Assert<Equal<Awaited<ReturnType<typeof getBoardDetail>>["data"], z.output<typeof boardDetailResponseSchema>>>;
export type CycleProducerParity = Assert<Equal<Pick<z.output<typeof cycleResponseSchema>, keyof JsonCycle>, Pick<JsonCycle, keyof JsonCycle>>>;
export type VersionProducerParity = Assert<Equal<Pick<z.output<typeof descriptionVersionsResponseSchema>["versions"][number], keyof JsonVersion>, Pick<JsonVersion, keyof JsonVersion>>>;
export type RelationProducerParity = Assert<Equal<Pick<z.output<typeof taskRelationSchema>, RelationFields>, Pick<Task, RelationFields>>>;
export type VersionsMethod = Assert<Equal<typeof descriptionVersionsRoute.method, "GET">>;
export type BoardMethod = Assert<Equal<typeof boardDetailRoute.method, "POST">>;
export type CycleQueryIsInferred = Assert<Equal<Parameters<typeof getTaskCycle>[0], z.input<typeof taskCycleRoute.query>>>;
export type BoardBodyIsInferred = Assert<Equal<Parameters<typeof getBoardDetail>[0], z.input<typeof boardDetailRoute.body>>>;

void getDescriptionVersions(12, new AbortController().signal);
void getTaskCycle({ taskId: 12, cursor: 20, query: "Cycle 2" });
void getBoardDetail({ projectId: 15, userId: 985 });
// @ts-expect-error numeric task ID only
void getDescriptionVersions("12");
// @ts-expect-error task ID is required
void getTaskCycle({ cursor: 20 });
// @ts-expect-error cursor is numeric
void getTaskCycle({ taskId: 12, cursor: "20" });
// @ts-expect-error preserve existing board request body
void getBoardDetail({ projectId: 15 });
// @ts-expect-error no caller-selected response
void getDescriptionVersions<{ arbitrary: true }>(12);
// @ts-expect-error no caller-selected response
void getTaskCycle<{ arbitrary: true }>({ taskId: 12 });
// @ts-expect-error no caller-selected response
void getBoardDetail<{ arbitrary: true }>({ projectId: 15, userId: 985 });
// @ts-expect-error route path params are inferred
void descriptionVersionsRoute.path({ taskId: "12" });
// @ts-expect-error negotiated relation query cannot use a different opt-in
const badCompat: z.input<typeof compactTaskRelationsRoute.query> = { compat: "other" };
void badCompat;
