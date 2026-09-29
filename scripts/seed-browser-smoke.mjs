import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const stateFile = process.env.BROWSER_SMOKE_STATE_FILE;
if (!stateFile) throw new Error("BROWSER_SMOKE_STATE_FILE is required");
if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createRequire(path.join(root, "package.json"))("jiti")(
  import.meta.url,
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);
const prisma = jiti(path.join(root, "src/lib/prisma.ts"));
const { SESSION_TTL_SECONDS, signSession } = jiti(
  path.join(root, "src/lib/auth/session.ts"),
);

const runKey = `${process.env.GITHUB_RUN_ID ?? process.pid}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}-${randomUUID()}`;

async function createBoard({ ownerId, teamId, title, suffix }) {
  const sectionTitles = ["To do", "Done"];
  const project = await prisma.project.create({
    data: {
      name: `browser-smoke-${suffix}-${runKey}`,
      title,
      ownerId,
      teamId,
      sections: sectionTitles,
    },
  });
  const sections = await Promise.all(
    sectionTitles.map((sectionTitle, index) =>
      prisma.section.create({
        data: {
          projectId: project.id,
          section_title: sectionTitle,
          ranking: index === 0 ? "A0100" : "A0200",
          isDone: index === 1,
        },
      }),
    ),
  );
  await prisma.member.create({
    data: { projectId: project.id, userId: ownerId },
  });
  await prisma.task.create({
    data: {
      uniqueIndex: 1,
      ticketNumber: `${suffix.toUpperCase()}-1`,
      title: `${title} fixture`,
      description: "",
      projectId: project.id,
      userId: ownerId,
      section: sections[0].section_title,
      sectionId: sections[0].id,
      ranking: "A0100",
    },
  });
  return project;
}

try {
  const user = await prisma.user.create({
    data: {
      uid: `browser-smoke-${runKey}`,
      email: `browser-smoke-${runKey}@example.invalid`,
      displayName: "Browser smoke user",
      UserSetting: {
        create: {
          notification: false,
          onboardingTourStatus: true,
          onboardingTutorialStatus: true,
        },
      },
    },
    include: { UserSetting: true },
  });
  if (user.id === 6 || user.id === 985) {
    throw new Error("Disposable browser smoke user received a reserved id");
  }
  if (!user.UserSetting) {
    throw new Error("Disposable browser smoke user has no settings");
  }
  await Promise.all([
    prisma.userPicture.create({
      data: {
        userId: user.id,
        displayName: user.displayName,
        basePhotoURL: user.photoURL,
      },
    }),
    prisma.user_Activity.create({
      data: {
        userId: user.id,
        totalTeamsOwned: 1,
        lastActiveAt: new Date(),
      },
    }),
  ]);

  const googleAccount = await prisma.googleAccount.create({
    data: {
      userId: user.id,
      stripe_customer_id: `browser-smoke-${runKey}`,
    },
  });
  const team = await prisma.team.create({
    data: {
      title: "Browser smoke",
      totalSeats: 1,
      googleAccountId: googleAccount.id,
    },
  });
  await Promise.all([
    prisma.team_Activity.create({
      data: {
        teamId: team.id,
        lastActiviyAt: new Date(),
      },
    }),
    prisma.member_Team.create({
      data: {
        userId: user.id,
        teamId: team.id,
        googleAccountId: googleAccount.id,
        status: "Accepted",
        acceptedAt: new Date(),
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        accountId: googleAccount.id,
        UserSettingId: user.UserSetting.id,
      },
    }),
  ]);

  const board = await createBoard({
    ownerId: user.id,
    teamId: team.id,
    title: "Browser smoke board",
    suffix: "board",
  });
  const demoBoard = await createBoard({
    ownerId: user.id,
    teamId: team.id,
    title: "Browser smoke demo board",
    suffix: "demo",
  });

  const sessionUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      uid: true,
      displayName: true,
      photoURL: true,
      email: true,
      joinedAt: true,
      UserSettingId: true,
      accountId: true,
      stripe_customer_id: true,
      UserSetting: true,
    },
  });
  if (!sessionUser) {
    throw new Error("Disposable browser smoke user disappeared");
  }

  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const cookieBase = {
    domain: "127.0.0.1",
    path: "/",
    expires,
    secure: false,
    sameSite: "Lax",
  };
  const state = {
    cookies: [
      {
        ...cookieBase,
        name: "ht_session",
        value: signSession({ id: user.id, email: user.email }),
        httpOnly: true,
      },
      {
        ...cookieBase,
        name: "nookies_user",
        value: encodeURIComponent(
          JSON.stringify(sessionUser),
        ),
        httpOnly: false,
      },
      {
        ...cookieBase,
        name: "previousBoard",
        value: `project-${board.id}|&|`,
        httpOnly: false,
      },
    ],
    origins: [],
  };

  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state), {
    flag: "wx",
    mode: 0o600,
  });
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `board_path=/project?id=${board.id}&surface=board\ndemo_board_path=/project?id=${demoBoard.id}&surface=board\n`,
  );
  console.log("Seeded isolated browser smoke fixtures.");
} finally {
  await prisma.$disconnect();
}
