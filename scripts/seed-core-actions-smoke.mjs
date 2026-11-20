import { chmod, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ARCHIVED_SMOKE_PROJECT_ENV, archivedSmokeProject, boardRecords, buildCoreSmokeSeedPlan, teamRoster } from "./lib/core-smoke-seed-plan.mjs";

const envFile = process.env.CORE_SMOKE_ENV_FILE;
if (!envFile) throw new Error("CORE_SMOKE_ENV_FILE is required");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = process.env.CORE_SMOKE_APP_ROOT ?? root;
const jiti = createRequire(path.join(appRoot, "package.json"))("jiti")(
  import.meta.url,
  {
    interopDefault: true,
    alias: { "@": path.join(appRoot, "src") },
  },
);
const prisma = jiti(path.join(appRoot, "src/lib/prisma.ts"));
const { signSession } = jiti(path.join(appRoot, "src/lib/auth/session.ts"));
const { createMcpToken } = jiti(path.join(appRoot, "src/lib/mcp/auth/verifyJwt.ts"));

const runKey = `${process.env.GITHUB_RUN_ID ?? process.pid}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}-${randomUUID()}`;
const displayName = `Core smoke user ${runKey}`;
const agentName = `Core smoke agent ${runKey}`;

const plan = buildCoreSmokeSeedPlan({ runKey });
const commented = new Set(plan.comments.map((comment) => `${comment.boardKey}:${comment.uniqueIndex}`));

try {
  const users = [];
  for (const member of plan.members) {
    users.push(await prisma.user.create({
      data: {
        uid: member.uid,
        email: member.email,
        displayName: member.displayName,
        UserSetting: { create: { notification: false, onboardingTourStatus: true } },
      },
    }));
  }
  const user = users[0];
  const googleAccount = await prisma.googleAccount.create({
    data: { userId: user.id, stripe_customer_id: `core-smoke-${runKey}` },
  });
  const team = await prisma.team.create({
    data: { title: "Core actions smoke", totalSeats: plan.members.length, googleAccountId: googleAccount.id },
  });
  const roster = new Set(teamRoster(plan).map((member) => member.uid));
  await prisma.member_Team.createMany({
    data: users.filter((member) => roster.has(member.uid)).map((member) => ({ userId: member.id, teamId: team.id, googleAccountId: googleAccount.id })),
  });
  const projects = new Map();
  for (const board of boardRecords(plan, googleAccount.id)) {
    projects.set(board.key, await prisma.project.create({
      data: { name: board.name, title: board.title, ownerId: user.id, teamId: team.id, googleAccountId: board.googleAccountId, sections: board.sections },
    }));
  }
  const archived = await prisma.project.create({
    data: archivedSmokeProject({ runKey, ownerId: user.id, teamId: team.id, googleAccountId: googleAccount.id }),
  });
  const sections = new Map();
  for (const board of plan.boards) {
    for (const [index, title] of board.sections.entries()) {
      sections.set(`${board.key}\0${title}`, await prisma.section.create({
        data: {
          projectId: projects.get(board.key).id,
          section_title: title,
          ranking: `A${String((index + 1) * 100).padStart(4, "0")}`,
        },
      }));
    }
  }
  const agent = await prisma.agent.create({ data: { displayName: agentName, userId: user.id } });
  await prisma.member.createMany({
    data: plan.boards.flatMap((board) => users.map((member) => {
      const row = { projectId: projects.get(board.key).id, userId: member.id };
      if (member.id === user.id) row.agentId = agent.id;
      return row;
    })),
  });
  await prisma.label.createMany({
    data: plan.labels.map((label) => ({ id: label.id, value: label.value, projectId: projects.get(label.boardKey).id })),
  });
  await prisma.task.createMany({
    data: plan.tasks.map((task) => ({
      uniqueIndex: task.uniqueIndex,
      ticketNumber: task.ticketNumber,
      title: task.title,
      description: "",
      projectId: projects.get(task.boardKey).id,
      userId: user.id,
      section: task.sectionTitle,
      sectionId: sections.get(`${task.boardKey}\0${task.sectionTitle}`).id,
      ranking: task.ranking,
      totalComments: commented.has(`${task.boardKey}:${task.uniqueIndex}`) ? 1 : 0,
    })),
  });
  const stored = await prisma.task.findMany({
    where: { projectId: { in: [...projects.values()].map((project) => project.id) } },
    select: { id: true, projectId: true, uniqueIndex: true },
  });
  const taskIds = new Map(stored.map((row) => [`${row.projectId}:${row.uniqueIndex}`, row.id]));
  const taskId = (boardKey, uniqueIndex) => taskIds.get(`${projects.get(boardKey).id}:${uniqueIndex}`);
  await prisma.comment.createMany({
    data: plan.comments.map((comment) => ({
      taskId: taskId(comment.boardKey, comment.uniqueIndex),
      creatorId: user.id,
      text: `<p>${comment.text}</p>`,
      commentText: comment.text,
    })),
  });
  await prisma.taskLabel.createMany({
    data: plan.taskLabels.map((link) => ({ taskId: taskId(link.boardKey, link.uniqueIndex), labelId: link.labelId })),
  });
  const project = projects.get("fixture");
  const sourceSection = sections.get("fixture\0Baseline");
  const targetSection = sections.get("fixture\0Alternate");
  const task = { id: taskId("fixture", 1) };

  const signedSession = signSession({ id: user.id, email: user.email });
  const mcpToken = createMcpToken(user.id, user.email);
  const legacyUser = encodeURIComponent(
    JSON.stringify({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    }),
  );
  const cookie = `nookies_user=${legacyUser}; ht_session=${signedSession}`;
  const firebasePrivateKey = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).privateKey.export({ type: "pkcs8", format: "pem" });
  const firebaseServiceAccount = Buffer.from(
    JSON.stringify({
      project_id: `core-smoke-${runKey}`,
      client_email: `core-smoke-${runKey}@example.invalid`,
      private_key: firebasePrivateKey,
    }),
  ).toString("base64");
  const betterAuthSecret = randomBytes(32).toString("base64url");
  const byokCipherSecret = randomBytes(32).toString("hex");
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const value of [
      cookie,
      firebaseServiceAccount,
      betterAuthSecret,
      byokCipherSecret,
      mcpToken,
    ]) {
      console.log(`::add-mask::${value}`);
    }
  }

  const values = {
    CORE_SMOKE_COOKIE: cookie,
    CORE_SMOKE_MCP_TOKEN: mcpToken,
    CORE_SMOKE_PROJECT_ID: project.id,
    [ARCHIVED_SMOKE_PROJECT_ENV]: archived.id,
    CORE_SMOKE_TASK_ID: task.id,
    CORE_SMOKE_USER_ID: user.id,
    CORE_SMOKE_USER_NAME: displayName,
    CORE_SMOKE_AGENT_ID: agent.id,
    CORE_SMOKE_AGENT_NAME: agentName,
    CORE_SMOKE_BASE_SECTION_ID: sourceSection.id,
    CORE_SMOKE_ALT_SECTION_ID: targetSection.id,
    FIREBASE_SERVICE_ACCOUNT_B64: firebaseServiceAccount,
    BETTER_AUTH_SECRET: betterAuthSecret,
    BYOK_CIPHER_SECRET: byokCipherSecret,
  };
  await writeFile(
    envFile,
    `${Object.entries(values)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n")}\n`,
    { flag: "wx", mode: 0o600 },
  );
  await chmod(envFile, 0o600);
  console.log(
    `Seeded core-actions fixture on board ${project.id}, task ${task.id}, archived board ${archived.id}, tickets ${plan.tasks.length}, members ${plan.members.length}.`,
  );
} finally {
  await prisma.$disconnect();
}
