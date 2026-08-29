import { Prisma } from "@prisma/client";
import { sanitizeBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { randomUUID } from "crypto";
import { endOfWeek, startOfWeek } from "date-fns";

import {
  defaultHour,
  defaultMinutes,
  PriorityConstants,
} from "@/lib/constants/constants";
import prisma from "@/lib/prisma";
import { getSequentialLetters } from "@/utils/helperFunctions/helperFunctions";
import { createProjectViewAndCreateDefault } from "@/utils/controllers/projects/create";
import { createProjectWithStableName } from "@/utils/controllers/projects/createProjectWithStableName";
import { getUniqueSlug } from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { createTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import { generateDemoBoard, type DemoBoard } from "./generateDemoBoard";
import {
  GUEST_SEED_TASKS,
  GUEST_SEED_TASKS_IN_PROGRESS,
} from "./guestSeedTasks";
import { GUEST_UID_PREFIX } from "./guest";

const USER_RECORD_INCLUDE = {
  UserSetting: true,
  userPicture: true,
} satisfies Prisma.UserInclude;

export type GuestUserRecord = Prisma.UserGetPayload<{
  include: typeof USER_RECORD_INCLUDE;
}>;

export type ProvisionedGuest = {
  userId: number;
  projectId: number;
  uniqueIdentifier: string;
  boardUrl: string;
  userRecord: GuestUserRecord;
};

export type GuestBoardOwner = {
  userId: number;
  googleAccountId: string;
  teamId: string;
};

export type ProvisionedGuestBoard = Omit<ProvisionedGuest, "userRecord">;

type GeneratedTaskRecord = {
  dueDate: Date | null;
  labelKey: string | null;
  priority: number | null;
};

type GeneratedLabel = {
  id: string;
  createdAt: Date;
  value: string | null;
  projectId: number | null;
};

type GuestBoardKind = "skeleton" | "generated" | "learn";

const sectionRanking = (index: number) => `A${String((index + 1) * 100).padStart(4, "0")}`;
const taskRanking = (index: number) => `A${String((index + 1) * 100).padStart(4, "0")}`;

function generatedViewSpecs(board: DemoBoard): DemoBoard["views"] {
  const seen = new Set<string>();
  return board.views.filter(({ title }) => {
    const key = title.trim().toLocaleLowerCase();
    if (!key || key === "board" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dueDateFromDays(dueInDays: number | null, now: Date): Date | null {
  if (dueInDays === null) return null;
  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + dueInDays);
  dueDate.setHours(defaultHour, defaultMinutes, 0, 0);
  return dueDate;
}

function priorityIndex(filterValue: string): number | null {
  const numericValue = Number(filterValue);
  if (Number.isInteger(numericValue) && numericValue >= 1 && numericValue <= 4) {
    return numericValue;
  }

  const normalized = filterValue.trim().toLocaleLowerCase();
  return (
    PriorityConstants.find(
      (priority) => priority.Priority_Value.toLocaleLowerCase() === normalized,
    )?.priority_index ?? null
  );
}

function buildGeneratedViewFilter({
  filterType,
  filterValue,
  labels,
  tasks,
}: DemoBoard["views"][number] & {
  labels: Map<string, GeneratedLabel>;
  tasks: GeneratedTaskRecord[];
}) {
  const normalizedValue = filterValue.trim().toLocaleLowerCase();

  if (filterType === "label") {
    const label = labels.get(normalizedValue);
    if (!label) return null;
    return {
      matchCount: tasks.filter((task) => task.labelKey === normalizedValue).length,
      filters: {
        matchFilters: "ANY",
        addedFilters: [{ type: "Labels", searchPayload: [label] }],
      },
    } as const;
  }

  if (filterType === "priority") {
    const index = priorityIndex(normalizedValue);
    const priority = PriorityConstants.find(
      (candidate) => candidate.priority_index === index,
    );
    if (!priority) return null;
    return {
      matchCount: tasks.filter((task) => task.priority === index).length,
      filters: {
        matchFilters: "ANY",
        addedFilters: [
          {
            type: "Priority",
            searchPayload: [{ id: priority.priority_index, ...priority }],
          },
        ],
      },
    } as const;
  }

  if (filterType === "due" && normalizedValue === "this-week") {
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    return {
      matchCount: tasks.filter(
        (task) =>
          task.dueDate !== null &&
          task.dueDate >= weekStart &&
          task.dueDate <= weekEnd,
      ).length,
      filters: {
        matchFilters: "ANY",
        addedFilters: [
          {
            type: "DueDate",
            searchPayload: [
              {
                id: 1,
                fromDate: null,
                toDate: null,
                selectedDate: null,
                condition: null,
                dynamicRange: "THIS_WEEK",
              },
            ],
          },
        ],
      },
    } as const;
  }

  return null;
}

async function createGeneratedViews({
  board,
  labels,
  projectId,
  tasks,
  userId,
}: {
  board: DemoBoard;
  labels: Map<string, GeneratedLabel>;
  projectId: number;
  tasks: GeneratedTaskRecord[];
  userId: number;
}) {
  const projectView = await prisma.project_View.findUniqueOrThrow({
    where: { projectId },
    include: {
      default_view: true,
      project: { include: { section: { where: { deleted: false } } } },
    },
  });
  if (!projectView.default_view) {
    throw new Error("Guest board default view was not created");
  }

  const createdViewIds: string[] = [];
  const usedTaskCounts = new Set<number>();
  for (const spec of generatedViewSpecs(board)) {
    if (createdViewIds.length >= 3) break;
    const generatedFilter = buildGeneratedViewFilter({ ...spec, labels, tasks });
    if (
      !generatedFilter ||
      generatedFilter.matchCount < 1 ||
      generatedFilter.matchCount >= tasks.length ||
      usedTaskCounts.has(generatedFilter.matchCount)
    ) {
      continue;
    }

    const title = spec.title.trim();
    const slug = await getUniqueSlug(projectView.id, title);
    const view = await prisma.view.create({
      data: {
        title,
        slug,
        project_view_id: projectView.id,
        userId,
        board_sorting_mode: "Manual",
        board_filters: sanitizeBoardFilters(
          generatedFilter.filters
        ) as unknown as Prisma.InputJsonValue,
        board_columns_view: projectView.project.section as unknown as Prisma.InputJsonValue,
        visibility: "Public",
        lastUsedAt: new Date(),
      },
    });
    await prisma.view_Last_Used.create({
      data: { userId, viewId: view.id, lastUsedAt: new Date() },
    });
    createdViewIds.push(view.id);
    usedTaskCounts.add(generatedFilter.matchCount);
  }

  const viewOrder = [projectView.default_view.id, ...createdViewIds];
  await prisma.$transaction([
    prisma.project_View.update({
      where: { id: projectView.id },
      data: { default_view_order: viewOrder },
    }),
    prisma.user_Project_View.upsert({
      where: {
        user_project: { userId, project_view_id: projectView.id },
      },
      create: {
        userId,
        project_view_id: projectView.id,
        view_order: viewOrder,
      },
      update: { view_order: viewOrder },
    }),
  ]);
}

async function provisionGeneratedBoard(
  board: DemoBoard,
  owner: GuestBoardOwner,
  {
    seedGuestInbox = false,
    boardKind = "generated",
  }: { seedGuestInbox?: boolean; boardKind?: GuestBoardKind } = {},
): Promise<ProvisionedGuestBoard> {
  const uniqueIdentifier = getSequentialLetters(`${board.name} demo`);
  // ponytail: the stable-name controller owns project creation outside the
  // caller's user transaction; board records are then written sequentially so
  // task numbers, rankings, labels, priorities, and due dates stay deterministic.
  const project = await createProjectWithStableName({
    ownerId: owner.userId,
    title: board.name,
    teamId: owner.teamId,
    googleAccountId: owner.googleAccountId,
    uniqueIdentifier,
  });
  await prisma.member.create({
    data: {
      userId: owner.userId,
      projectId: project.id,
      agentId: null,
      role: "Admin",
      status: "Accepted",
      acceptedAt: new Date(),
    },
  });

  const labels = new Map<string, GeneratedLabel>();
  const tasks: GeneratedTaskRecord[] = [];
  const createdTaskIds: number[] = [];
  const dueDateBase = new Date();
  let taskCount = 0;
  for (const [columnIndex, column] of board.columns.entries()) {
    const section = await prisma.section.create({
      data: {
        projectId: project.id,
        section_title: column.title,
        ranking: sectionRanking(columnIndex),
      },
    });

    for (const [taskIndex, task] of column.tasks.entries()) {
      const dueDate =
        boardKind === "skeleton" && taskCount === 0
          ? dueDateFromDays(-1, dueDateBase)
          : dueDateFromDays(task.dueInDays, dueDateBase);
      const created = await createTaskCore({
        title: task.title,
        description:
          (task as { description?: string }).description ?? "",
        userId: owner.userId,
        projectId: project.id,
        sectionId: section.id,
        sectionTitle: section.section_title,
        projectIdentifier: uniqueIdentifier,
        ranking: taskRanking(taskIndex),
        priorityIndex: task.priority ?? 0,
        dueDate: dueDate ?? undefined,
        updateTeamActivity: false,
      });
      taskCount += 1;
      createdTaskIds.push(created.task.id);

      if (
        boardKind === "skeleton" ||
        (boardKind === "generated" && taskIndex % 2 === 0)
      ) {
        await prisma.assignees.create({
          data: {
            assignerId: owner.userId,
            taskId: created.task.id,
            userId: owner.userId,
          },
        });
      }

      const labelValue = task.label?.trim();
      const labelKey = labelValue?.toLocaleLowerCase() ?? null;
      if (labelValue) {
        let label = labels.get(labelKey!);
        if (!label) {
          label = await prisma.label.create({
            data: { projectId: project.id, value: labelValue },
          });
          labels.set(labelKey!, label);
        }
        await prisma.taskLabel.create({
          data: { taskId: created.task.id, labelId: label.id },
        });
      }

      tasks.push({
        dueDate,
        labelKey,
        priority: task.priority,
      });
    }
  }

  if (seedGuestInbox) {
    await prisma.$transaction(async (tx) => {
      const agent = await tx.agent.create({
        data: {
          displayName: "Hyper AI",
          userId: owner.userId,
        },
        select: { id: true },
      });
      await tx.notification.createMany({
        data: createdTaskIds.map((taskId) => ({
          userId: owner.userId,
          fromUserId: owner.userId,
          fromAgentId: agent.id,
          taskId,
          projectId: project.id,
          type: "Assigned",
          seen: false,
        })),
      });
    });
  }

  await prisma.team_Activity.update({
    where: { teamId: owner.teamId },
    data: { total_tasks: { increment: taskCount }, lastActiviyAt: new Date() },
  });
  await createProjectViewAndCreateDefault({
    projectId: project.id,
    userId: owner.userId,
  });
  await createGeneratedViews({
    board,
    labels,
    projectId: project.id,
    tasks,
    userId: owner.userId,
  });

  return {
    userId: owner.userId,
    projectId: project.id,
    uniqueIdentifier,
    boardUrl: `/project?id=${project.id}`,
  };
}

// HTPR-4875: the default /demo entry lands on the board immediately, so it gets
// this skeleton (default columns, starter tasks, no views) and no AI call. Generation
// runs only when someone describes a project in the board creation assistant.
const EMPTY_BOARD: DemoBoard = {
  name: "My Board",
  views: [],
  columns: [
    {
      title: "To Do",
      // Two selling-point seeds; the client still treats a board holding only
      // these as empty, so the chat keeps offering to build the real board.
      // The AI board schema has no description field, so the seeds smuggle
      // theirs past the type and provisionGeneratedBoard picks it up.
      tasks: GUEST_SEED_TASKS.map(({ title, description }) => ({
        title,
        description,
        label: null,
        priority: null,
        dueInDays: null,
      })) as unknown as DemoBoard["columns"][number]["tasks"],
    },
    {
      title: "In Progress",
      tasks: GUEST_SEED_TASKS_IN_PROGRESS.map(({ title, description }) => ({
        title,
        description,
        label: null,
        priority: null,
        dueInDays: null,
      })) as unknown as DemoBoard["columns"][number]["tasks"],
    },
    { title: "Done", tasks: [] },
  ],
};

const LEARN_BOARD: DemoBoard = {
  name: "Learn Hypertask",
  views: [],
  columns: [
    {
      title: "To Do",
      tasks: [
        {
          title: "Explore your first board",
          label: null,
          priority: null,
          dueInDays: null,
        },
        {
          title: "Move between tasks with J and K",
          label: null,
          priority: null,
          dueInDays: null,
        },
        {
          title: "Open a task with Enter",
          label: null,
          priority: null,
          dueInDays: null,
        },
      ],
    },
    {
      title: "In Progress",
      tasks: [
        {
          title: "Try the command center",
          label: null,
          priority: null,
          dueInDays: null,
        },
        {
          title: "Create your next task",
          label: null,
          priority: null,
          dueInDays: null,
        },
      ],
    },
    {
      title: "Done",
      tasks: [
        {
          title: "Start the Hypertask tutorial",
          label: null,
          priority: null,
          dueInDays: null,
        },
      ],
    },
  ],
};

const boardFor = (purpose: string) =>
  purpose ? generateDemoBoard(purpose) : Promise.resolve(EMPTY_BOARD);

export async function provisionGuestBoard(
  purpose: string,
  owner: GuestBoardOwner,
): Promise<ProvisionedGuestBoard> {
  return provisionGeneratedBoard(await boardFor(purpose), owner, {
    boardKind: purpose ? "generated" : "skeleton",
  });
}

export async function provisionLearnBoard(
  owner: GuestBoardOwner,
): Promise<ProvisionedGuestBoard> {
  return provisionGeneratedBoard(LEARN_BOARD, owner, { boardKind: "learn" });
}

export async function provisionGuest(purpose: string): Promise<ProvisionedGuest> {
  const board = await boardFor(purpose);
  const guestUuid = randomUUID();
  const uid = `${GUEST_UID_PREFIX}${guestUuid}`;
  const email = `guest+${guestUuid}@demo.hypertask.ai`;

  const owner = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        uid,
        email,
        displayName: "Guest",
        stripe_customer_id: null,
      },
    });
    const userSetting = await tx.userSetting.create({
      data: {
        userId: user.id,
        onboardingTourStatus: true,
        onboardingTutorialStatus: true,
        // HTPR-4303: guests have a throwaway email; mark verified so no
        // isVerified-gated surface (e.g. the verify-email wall) blocks them.
        isVerified: true,
        notification: true,
        ...(board === EMPTY_BOARD
          ? { notificationMatrix: { showImportantSplit: true } }
          : {}),
      },
    });
    await Promise.all([
      tx.userPicture.create({
        data: { userId: user.id, displayName: "Guest", basePhotoURL: null },
      }),
      tx.user_Activity.create({
        data: { userId: user.id, totalTeamsOwned: 1, lastActiveAt: new Date() },
      }),
    ]);
    const googleAccount = await tx.googleAccount.create({
      data: { userId: user.id, stripe_customer_id: "" },
    });
    const team = await tx.team.create({
      data: {
        title: "Guest workspace",
        googleAccountId: googleAccount.id,
        stripe_customer_id: null,
        totalSeats: 1,
      },
    });
    await Promise.all([
      tx.team_Activity.create({
        data: { teamId: team.id, lastActiviyAt: new Date() },
      }),
      tx.member_Team.create({
        data: {
          userId: user.id,
          teamId: team.id,
          googleAccountId: googleAccount.id,
          status: "Accepted",
          acceptedAt: new Date(),
        },
      }),
      tx.user.update({
        where: { id: user.id },
        data: { UserSettingId: userSetting.id, accountId: googleAccount.id },
      }),
    ]);

    return {
      userId: user.id,
      googleAccountId: googleAccount.id,
      teamId: team.id,
    };
  });

  const provisionedBoard = await provisionGeneratedBoard(board, owner, {
    seedGuestInbox: board === EMPTY_BOARD,
    boardKind: purpose ? "generated" : "skeleton",
  });
  const userRecord = await prisma.user.findUniqueOrThrow({
    where: { id: owner.userId },
    include: USER_RECORD_INCLUDE,
  });

  return { ...provisionedBoard, userRecord };
}
