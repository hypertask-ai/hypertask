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
import { getDescriptionVersions, getTaskCycle, getBoardDetail, descriptionVersionsRoute, taskCycleRoute, boardDetailRoute } from "@/lib/api/typedClient";
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

import type { Priority, Estimate, TaskLabel, Assignees } from "@prisma/client";
import { setTaskPriority, setTaskEstimate, setTaskDueDate, setTaskStartDate, setTaskWaitingOn, assignTaskUser, assignTaskLabel, moveTask, readMoveTaskResponse, taskPriorityRoute, taskEstimateRoute, taskDueDateRoute, taskStartDateRoute, taskWaitingOnRoute, taskAssigneeRoute, taskLabelRoute, moveTaskRoute } from "@/lib/api/typedClient";
import { taskPropertyResponseSchema, waitingOnResponseSchema, priorityResponseSchema, estimateResponseSchema, assigneeResponseSchema, labelResponseSchema } from "@/lib/api/contracts/taskWrites";

type JsonPriority = Omit<Priority, "createdAt"> & { createdAt: string };
type JsonEstimate = Omit<Estimate, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string | null };
type PriorityRow = Extract<z.output<typeof priorityResponseSchema>, { id: string }>;
type EstimateRow = Extract<z.output<typeof estimateResponseSchema>, { id: string }>;
export type PriorityProducerParity = Assert<Equal<Pick<PriorityRow, keyof JsonPriority>, Pick<JsonPriority, keyof JsonPriority>>>;
export type EstimateProducerParity = Assert<Equal<Pick<EstimateRow, keyof JsonEstimate>, Pick<JsonEstimate, keyof JsonEstimate>>>;
type PropertyFields = RelationFields | "section";
export type PropertyProducerParity = Assert<Equal<Pick<z.output<typeof taskPropertyResponseSchema>, PropertyFields>, Pick<Task, PropertyFields>>>;
export type WaitingProducerParity = Assert<Equal<Pick<z.output<typeof waitingOnResponseSchema>, "id" | "waitingOnUserId" | "waitingOnSetById">, Pick<Task, "id" | "waitingOnUserId" | "waitingOnSetById">>>;
export type LabelProducerParity = Assert<Equal<Pick<z.output<typeof labelResponseSchema>[number], keyof TaskLabel>, TaskLabel>>;
export type AssigneeProducerParity = Assert<Equal<Pick<z.output<typeof assigneeResponseSchema>["body"][number], "id" | "taskId" | "userId" | "agentId">, Pick<Assignees, "id" | "taskId" | "userId" | "agentId">>>;
export type PriorityWriteData = Assert<Equal<Awaited<ReturnType<typeof setTaskPriority>>["data"], z.output<typeof taskPriorityRoute.success>>>;
export type EstimateWriteData = Assert<Equal<Awaited<ReturnType<typeof setTaskEstimate>>["data"], z.output<typeof taskEstimateRoute.success>>>;
export type DueDateWriteData = Assert<Equal<Awaited<ReturnType<typeof setTaskDueDate>>["data"], z.output<typeof taskDueDateRoute.success>>>;
export type StartDateWriteData = Assert<Equal<Awaited<ReturnType<typeof setTaskStartDate>>["data"], z.output<typeof taskStartDateRoute.success>>>;
export type WaitingOnWriteData = Assert<Equal<Awaited<ReturnType<typeof setTaskWaitingOn>>["data"], z.output<typeof taskWaitingOnRoute.success>>>;
export type AssigneeWriteData = Assert<Equal<Awaited<ReturnType<typeof assignTaskUser>>["data"], z.output<typeof taskAssigneeRoute.success>>>;
export type LabelWriteData = Assert<Equal<Awaited<ReturnType<typeof assignTaskLabel>>["data"], z.output<typeof taskLabelRoute.success>>>;
export type MoveWriteData = Assert<Equal<Awaited<ReturnType<typeof readMoveTaskResponse>>, z.output<typeof moveTaskRoute.success>>>;
export type PriorityInput = Assert<Equal<Parameters<typeof setTaskPriority>[0], z.input<typeof taskPriorityRoute.body>>>;
export type MoveInput = Assert<Equal<Parameters<typeof moveTask>[0], z.input<typeof moveTaskRoute.body>>>;
void setTaskPriority({ taskId: 12, priority_index: 0, Priority_Value: "No Priority" });
void setTaskDueDate({ taskId: 12, dueDate: new Date() });
void setTaskStartDate({ taskId: 12, startDate: null });
void assignTaskUser({ taskId: 12, agentId: "agent-id", intent: "unassign" });
// @ts-expect-error no string task ID
void setTaskPriority({ taskId: "12", priority_index: 1, Priority_Value: "High" });
// @ts-expect-error no unsupported assignee intent
void assignTaskUser({ taskId: 12, userId: 985, intent: "remove" });
// @ts-expect-error section ID is required
void moveTask({ taskId: 12, projectId: 15, section_title: "Doing" });
// @ts-expect-error labels use string IDs
void assignTaskLabel({ taskId: 12, labelId: 42 });
// @ts-expect-error caller cannot choose a response type
void setTaskPriority<{ arbitrary: true }>({ taskId: 12, priority_index: 1, Priority_Value: "High" });
// @ts-expect-error wire date is not a hydrated Date
const wrongWriteDate: z.output<typeof taskPropertyResponseSchema>["dueDate"] = new Date();
void wrongWriteDate;

import type { Section, Notification } from "@prisma/client";
import { createSection, updateSection, setNotificationSeen, unarchiveNotification, archiveNotifications, toggleNotificationArchive, sectionCreateRoute, sectionUpdateRoute, notificationSeenRoute, notificationUnarchiveRoute, notificationBulkArchiveRoute } from "@/lib/api/typedClient";
import { sectionResponseSchema } from "@/lib/api/contracts/sectionWrites";
import { notificationResponseSchema } from "@/lib/api/contracts/notificationWrites";

type SectionFields = "id" | "projectId" | "section_title" | "visibility" | "deleted" | "ranking" | "isDone";
type NotificationFields = "id" | "type" | "userId" | "taskId" | "projectId" | "status" | "seen";
export type SectionProducerParity = Assert<Equal<Pick<z.output<typeof sectionResponseSchema>, SectionFields>, Pick<Section, SectionFields>>>;
export type NotificationProducerParity = Assert<Equal<Pick<z.output<typeof notificationResponseSchema>, NotificationFields>, Pick<Notification, NotificationFields>>>;
export type SectionCreateData = Assert<Equal<Awaited<ReturnType<typeof createSection>>["data"], z.output<typeof sectionCreateRoute.success>>>;
export type SectionUpdateData = Assert<Equal<Awaited<ReturnType<typeof updateSection>>["data"], z.output<typeof sectionUpdateRoute.success>>>;
export type NotificationSeenData = Assert<Equal<Awaited<ReturnType<typeof setNotificationSeen>>["data"], z.output<typeof notificationSeenRoute.success>>>;
export type NotificationUnarchiveData = Assert<Equal<Awaited<ReturnType<typeof unarchiveNotification>>["data"], z.output<typeof notificationUnarchiveRoute.success>>>;
export type NotificationBulkData = Assert<Equal<Awaited<ReturnType<typeof archiveNotifications>>["data"], z.output<typeof notificationBulkArchiveRoute.success>>>;
export type SectionUpdateInput = Assert<Equal<Parameters<typeof updateSection>[0], z.input<typeof sectionUpdateRoute.body>>>;
export type NotificationSeenInput = Assert<Equal<Parameters<typeof setNotificationSeen>[0], z.input<typeof notificationSeenRoute.query>>>;
export type NotificationArchiveResponse = Assert<Equal<Awaited<ReturnType<typeof toggleNotificationArchive>>, Response>>;
void createSection({ projectId: 15, title: "Next" });
void updateSection({ userId: 985, sectionId: 12, newSection: { ranking: "A0150" } });
void setNotificationSeen({ notificationId: 12, seen: 0 });
void unarchiveNotification({ notificationId: 12 });
// @ts-expect-error section IDs are numeric
void updateSection({ sectionId: "12", newSection: { deleted: true } });
// @ts-expect-error read query uses the legacy numeric switch, not a boolean
void setNotificationSeen({ notificationId: 12, seen: true });
// @ts-expect-error archive query retains the caller's user ID
void toggleNotificationArchive({ id: "12", taskId: null, type: "Comment" }, {});
// @ts-expect-error bulk caller sends Archive, not a new status
void archiveNotifications({ notificationIds: [], status: "Deleted" }, {});
// @ts-expect-error caller cannot invent the response type
void createSection<{ arbitrary: true }>({ projectId: 15, title: "Next" });
