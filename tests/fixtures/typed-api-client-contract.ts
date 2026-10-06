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
