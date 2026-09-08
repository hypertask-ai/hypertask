import { chmod, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

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

const runKey = `${process.env.GITHUB_RUN_ID ?? process.pid}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}-${randomUUID()}`;
const displayName = `Core smoke user ${runKey}`;
const agentName = `Core smoke agent ${runKey}`;

try {
  const user = await prisma.user.create({
    data: {
      uid: `core-smoke-${runKey}`,
      email: `core-smoke-${runKey}@example.invalid`,
      displayName,
      UserSetting: {
        create: { notification: false },
      },
    },
  });
  const googleAccount = await prisma.googleAccount.create({
    data: {
      userId: user.id,
      stripe_customer_id: `core-smoke-${runKey}`,
    },
  });
  const team = await prisma.team.create({
    data: {
      title: "Core actions smoke",
      totalSeats: 1,
      googleAccountId: googleAccount.id,
    },
  });
  const project = await prisma.project.create({
    data: {
      name: `core-smoke-${runKey}`,
      title: "Core actions smoke",
      ownerId: user.id,
      teamId: team.id,
      sections: ["Baseline", "Alternate"],
    },
  });
  const [sourceSection, targetSection] = await Promise.all([
    prisma.section.create({
      data: {
        projectId: project.id,
        section_title: "Baseline",
        ranking: "A0100",
      },
    }),
    prisma.section.create({
      data: {
        projectId: project.id,
        section_title: "Alternate",
        ranking: "A0200",
      },
    }),
  ]);
  const agent = await prisma.agent.create({
    data: { displayName: agentName, userId: user.id },
  });
  await prisma.member.create({
    data: { projectId: project.id, userId: user.id, agentId: agent.id },
  });
  const task = await prisma.task.create({
    data: {
      uniqueIndex: 1,
      ticketNumber: "SMOKE-1",
      title: "Core actions smoke fixture",
      description: "",
      projectId: project.id,
      userId: user.id,
      section: sourceSection.section_title,
      sectionId: sourceSection.id,
      ranking: "A0100",
    },
  });

  const signedSession = signSession({ id: user.id, email: user.email });
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
    ]) {
      console.log(`::add-mask::${value}`);
    }
  }

  const values = {
    CORE_SMOKE_COOKIE: cookie,
    CORE_SMOKE_PROJECT_ID: project.id,
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
    `Seeded core-actions fixture on board ${project.id}, task ${task.id}.`,
  );
} finally {
  await prisma.$disconnect();
}
