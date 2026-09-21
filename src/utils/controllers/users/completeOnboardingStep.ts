import { CreateLogInput, IUser } from "@/models/model";
import { getSequentialLetters } from "@/utils/helperFunctions/helperFunctions";
import { LogType, Status } from "@prisma/client";
import createLog from "@/utils/controllers/logs/createLog";
import prisma from "@/lib/prisma";
import { stripe } from "@/lib/subscription";
import { createProjectViewAndCreateDefault } from "../projects/create";
import { generalConfig } from "@/lib/configs/general.config";
import { createProjectWithStableName } from "../projects/createProjectWithStableName";
import { createTaskCore } from "../tasks/createTaskCore";
import assigneesAssign from "../assignees/assign";

type CompleteOnboardingFirstStepOptions = {
  createInitialBoard?: boolean;
};

/**
 * Completes the first step of onboarding for a new user.
 * 
 * This function performs the following operations:
 * 1. Finds or creates a Google account linked to the user.
 * 2. Ensures a Stripe customer exists for billing purposes.
 * 3. Creates a new Team associated with the Google account and Stripe customer.
 * 
 * @param exist_user - The user object (IUser) who is onboarding.
 * @param teamTitle - The title/name for the new team to be created.
 * @param boardTitle - The title for the initial board (not directly used in this snippet).
 * @param companySize - Size of the company (not directly used in this snippet).
 * @param companyRole - Role of the user in the company (not directly used in this snippet).
 * @returns A Promise resolving with the result of the onboarding operation, or an error if encountered.
 */
export const CompleteOnboardingFirstStep = async (
  exist_user: IUser,
  teamTitle: string,
  boardTitle: string,
  companySize: string,
  companyRole: string,
  options: CompleteOnboardingFirstStepOptions = {}
) => {
  try {
    // finding the google account we created during signup
    console.log(
      "-------- finding the google account we created during signup ----------"
    );
    let googleAccount = await prisma.googleAccount.findFirst({
      where: {
        userId: exist_user.id,
      },
    });
    console.log("🚀 Found googleAccount:", googleAccount);
    if (!googleAccount) {
      // HTPR-4852: email-link/code signups have no googleAccount yet. Create it
      // and continue, so first-ever signups still get their team/board (the old
      // early return here left them boardless).
      googleAccount = await prisma.googleAccount.create({
        data: {
          userId: exist_user.id,
          stripe_customer_id: exist_user.stripe_customer_id || "",
        },
      });
      console.log("🚀 Created new googleAccount:", googleAccount);
    }
    const customer = await createCustomerIfNull(
      googleAccount.stripe_customer_id,
      String(exist_user?.email) + `${googleAccount.id}`,
      googleAccount.id
    );

    console.log(
      "============= google Account and stripe customer account ========= ",
      customer
    );
    console.log("++++++++++++++++++++++++");
    // =================== CREATE TEAM against the google account

    console.log("-------- Creating a team ----------");

    const Team = await prisma.team.create({
      data: {
        title: teamTitle,
        googleAccountId: googleAccount.id,
        stripe_customer_id: customer.id,
        totalSeats: 1,
        survey: {
          companySize,
          companyRole,
        },
      },
    });
    let Project = null;
    console.log(" Team Created ========> ", Team);
    await prisma.team_Activity.create({
      data: {
        lastActiviyAt: new Date(),
        teamId: Team.id,
      },
    });
    await prisma.user_Activity.update({
      where: { userId: exist_user.id },
      data: { totalTeamsOwned: { increment: 1 } },
    });
    const TeamCreateLog: CreateLogInput = {
      log: `${exist_user.displayName} created a New Team "${Team.title}"`,
      type: LogType.Team,
      status: Status.Normal,
      LoggedById: exist_user.id,
    };
    createLog(TeamCreateLog);
    if (options.createInitialBoard !== false) {
      Project = await createOnboardingSampleBoardProject({
        exist_user,
        boardTitle,
        Team,
        googleAccount,
      });
    } else {
      console.log("============== skipping initial board creation ============");
    }

    //Commented this out.
    //This ensures new users get Welcome Announcements.
    // try {
    //   const announcements = await prisma.announcments.findMany({
    //     where: {
    //       isWelcome: true,
    //     },
    //     orderBy: {
    //       createdAt: "desc",
    //     },
    //   });

    //   if (announcements && announcements.length > 0) {
    //     for (const ann of announcements) {
    //       console.log(
    //         "🤔 ~ CompleteOnboardingFirstStep ~ announcements:",
    //         ann,
    //         exist_user.id
    //       );

    //       await prisma.userAnnouncement.create({
    //         data: {
    //           userId: exist_user.id,
    //           announcementId: ann.id,
    //         },
    //       });
    //     }
    //   }
    // } catch (error) {
    //   console.log("🤔 ~ CompleteOnboardingFirstStep ~ error:", error);
    // }

    return { Project, Team };
  } catch (error) {
    console.error("🚀 ~ CompleteOnboardingFirstStep ~ error:", error);
    throw error;
  }
};

// Static starter board seeded into the new user's OWN team when AI board
// generation is skipped or unavailable. Replaces the old clone of the
// support-account "welcome board" (project 206) — a single point of failure
// that produced an identical, unpersonalized board for every user.
// HTPR-4866: no sample tasks for now. The section structure below still seeds,
// plus the single CONNECT_AI_TASK; flip this back to true to restore the rest.
const SEED_STARTER_TASKS: boolean = false;

// HTPR-4866: the one task every fresh board starts with. Assigned to the new
// user (by HyperAI) so it also lands unread in their inbox.
const CONNECT_AI_TASK = {
  title: "Connect Hypertask to Claude or ChatGPT",
  description: [
    "<p><strong>Give Claude or ChatGPT access to this board so it can read, create and update your tasks.</strong></p>",
    "<p>Open <strong>Settings &gt; Connect &gt; MCP</strong>, generate a token, then copy the ready-made config into your AI client. The server is <strong>https://mcp.hypertask.ai/mcp</strong>.</p>",
    "<p>Working in a terminal instead? <strong>Settings &gt; Connect &gt; CLI</strong> covers Claude Code:</p>",
    "<ul>",
    "<li><strong>npm install -g @hypertask/hypertask_cli</strong></li>",
    "<li><strong>hypertask login</strong></li>",
    "</ul>",
  ].join(""),
};

const STARTER_BOARD_SECTIONS: {
  section_title: string;
  ranking: string;
  tasks: { title: string; description: string }[];
}[] = [
  {
    section_title: "To Do",
    ranking: "A0100",
    tasks: [
      {
        title: "Add your first task — press C",
        description:
          "<p>Press <strong>C</strong> anywhere on the board to create a task. Type a title, hit Enter. That's the whole loop, and it's the fastest one you'll find.</p>",
      },
      {
        title: "Run anything from the command bar — Ctrl/Cmd + K",
        description:
          "<p>One shortcut reaches every action, board, and task in Hypertask. When you forget a key, <strong>Ctrl/Cmd + K</strong> is the one to remember.</p>",
      },
      {
        title: "Let the AI plan your work — press 5",
        description:
          "<p>Press <strong>5</strong> to open the AI chat and tell it what you're working on. It drafts tasks, breaks down big ones, and reshapes your board on request.</p>",
      },
      {
        title: "Assign a teammate — press A",
        description:
          "<p>Select a task and press <strong>A</strong> to hand it off. Invite people from Settings first if it's just you so far.</p>",
      },
    ],
  },
  {
    section_title: "In Progress",
    ranking: "A0200",
    tasks: [
      {
        title: "Move me to Done — Shift + L",
        description:
          "<p>Select this task and press <strong>Shift + L</strong> to push it one column right (<strong>Shift + H</strong> moves left). Dragging works too, but the keys are quicker.</p>",
      },
    ],
  },
  {
    section_title: "Done",
    ranking: "A0300",
    tasks: [
      {
        title: "First task complete 🎉",
        description:
          "<p>Parked here so you can see the Done column. Clear out these starter tasks whenever you're ready — press <strong>#</strong> to delete a selected one.</p>",
      },
    ],
  },
];

export const createOnboardingSampleBoardProject = async ({
  exist_user,
  boardTitle,
  Team,
  googleAccount,
}: {
  exist_user: IUser;
  boardTitle: string;
  Team: { id: string; title: string | null };
  googleAccount: { id: string };
}) => {
  const uniqueIdentifier = getSequentialLetters(boardTitle);

  const Project = await createProjectWithStableName({
    ownerId: exist_user.id,
    title: boardTitle,
    teamId: Team.id,
    googleAccountId: googleAccount.id,
    uniqueIdentifier,
    // Keep the Project.sections scalar (exposed to MCP agents as defaultSections)
    // in sync with the relational sections we create below.
    sections: STARTER_BOARD_SECTIONS.map((s) => s.section_title),
  });

  const projectIdentifier = (
    Project.uniqueIdentifier ?? uniqueIdentifier
  ).toUpperCase();

  // Seed sections + starter tasks in order. Tasks are attributed to HyperAI so
  // they read as set up by the assistant. createTaskCore auto-ranks each task
  // after the previous one in its section, preserving the listed order.
  // Best-effort: each section and task is guarded independently so a single
  // failure never breaks signup and never abandons the rest of the board.
  let firstSection: { id: number; section_title: string } | undefined;
  for (const sectionDef of STARTER_BOARD_SECTIONS) {
    let section;
    try {
      section = await prisma.section.create({
        data: {
          section_title: sectionDef.section_title,
          ranking: sectionDef.ranking,
          project: { connect: { id: Project.id } },
        },
      });
    } catch (error) {
      console.error(
        `Error creating onboarding starter section "${sectionDef.section_title}" (skipping):`,
        error
      );
      continue;
    }
    firstSection ??= section;

    for (const task of SEED_STARTER_TASKS ? sectionDef.tasks : []) {
      try {
        await createTaskCore({
          title: task.title,
          description: task.description,
          userId: generalConfig.hyperAiId,
          projectId: Project.id,
          sectionId: section.id,
          sectionTitle: section.section_title,
          projectIdentifier,
          createDrafts: false,
          // Avoid 6 fire-and-forget team_Activity updates (lost/rejected under
          // serverless); starter-task counts don't need to bump team stats.
          updateTeamActivity: false,
        });
      } catch (error) {
        console.error(
          `Error creating onboarding starter task "${task.title}" (skipping):`,
          error
        );
      }
    }
  }

  // HTPR-4866: the single starter task, in the first section, assigned to the
  // new user. Assigning through assigneesAssign (not a direct Assignees insert)
  // is what also creates the unread "Assigned" notification, so the task shows
  // up in their inbox with the blue indicator. Best-effort like the rest.
  if (firstSection) {
    try {
      const { task } = await createTaskCore({
        title: CONNECT_AI_TASK.title,
        description: CONNECT_AI_TASK.description,
        userId: generalConfig.hyperAiId,
        projectId: Project.id,
        sectionId: firstSection.id,
        sectionTitle: firstSection.section_title,
        projectIdentifier,
        createDrafts: false,
        updateTeamActivity: false,
      });
      const hyperAi = await prisma.user.findUnique({
        where: { id: generalConfig.hyperAiId },
      });
      if (hyperAi) {
        await assigneesAssign(
          hyperAi as unknown as IUser,
          exist_user.id,
          task.id,
          undefined,
          undefined,
          { intent: "assign" }
        );
      }
    } catch (error) {
      console.error(
        `Error creating onboarding task "${CONNECT_AI_TASK.title}" (skipping):`,
        error
      );
    }
  }

  createProjectViewAndCreateDefault({
    projectId: Project.id,
    userId: exist_user.id,
  });

  const logBody: CreateLogInput = {
    log: `${exist_user.displayName} created a board "${boardTitle}" in team "${Team?.title}"`,
    type: LogType.Team,
    status: Status.Normal,
    LoggedById: exist_user.id,
  };
  createLog(logBody);

  return Project;
};

const createCustomerIfNull = async (
  customerId: string,
  newStripeId: string,
  googleAccountId: string
) => {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer) throw "User might not exist";
    else return customer;
  } catch (error) {
    // =================== CREATE stripe customer
    const customer = await stripe.customers.create({
      name: newStripeId,
    });
    // now update the googleaccount with the right stripeId
    await prisma.googleAccount.update({
      where: {
        id: googleAccountId,
      },
      data: {
        stripe_customer_id: customer.id,
      },
    });
    return customer;
  }
};