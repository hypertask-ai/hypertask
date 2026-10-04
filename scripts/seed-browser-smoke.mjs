import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { localFlagModes, readPlainQaFlags } from "./premerge-local-flags.mjs";

const stateFile = process.env.BROWSER_SMOKE_STATE_FILE;
if (!stateFile) throw new Error("BROWSER_SMOKE_STATE_FILE is required");
if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
if (!process.env.DATABASE_URL || !["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Browser smoke seeding requires an isolated loopback database");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureFile = path.join(path.dirname(stateFile), "card-fixture.json");
// A dated, credential-free copy of the live modes. Refresh it when release modes change.
let { modes } = JSON.parse(await readFile(path.join(root, "e2e/smoke/production-flag-modes.json"), "utf8"));
const localPremerge = process.env.PREMERGE_LOCAL === "1";
const instantOpenControl = process.argv.includes("--instant-open-control");
if (instantOpenControl) modes["htpr-6752-instant-ticket-open"] = "EVERYONE";
for (const [key, mode] of Object.entries(modes)) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || !["OFF", "OWNER_ONLY", "OWNER_AND_QA", "EVERYONE"].includes(mode)) {
    throw new Error("Invalid production flag-mode snapshot");
  }
}
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

async function createBoard({ ownerId, teamId, googleAccountId, title, suffix }) {
  const sectionTitles = ["To do", "Done"];
  const project = await prisma.project.create({
    data: {
      name: `browser-smoke-${suffix}-${runKey}`,
      title,
      ownerId,
      teamId,
      googleAccountId,
      uniqueIdentifier: suffix.toUpperCase(),
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
  const task = await prisma.task.create({
    data: {
      uniqueIndex: 1,
      ticketNumber: `${suffix.toUpperCase()}-1`,
      title: `${title} fixture`,
      updatedAt: new Date(),
      description: "",
      description_: {
        create: { content: "<p>This seeded ticket must open from its board card.</p>", creatorId: ownerId },
      },
      projectId: project.id,
      userId: ownerId,
      section: sections[0].section_title,
      sectionId: sections[0].id,
      ranking: "A0100",
    },
  });
  return { ...project, task };
}

async function seedSessionFixtures(flags) {
  const user = await prisma.user.create({
    data: {
      uid: `browser-smoke-${runKey}`,
      ...(localPremerge ? { id: 985 } : {}),
      email: localPremerge ? "valentin@hypertask.ai" : `browser-smoke-${runKey}@example.invalid`,
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
  if (user.id === 6 || (!localPremerge && user.id === 985)) {
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
    googleAccountId: googleAccount.id,
    title: "Browser smoke board",
    suffix: "board",
  });
  const demoBoard = await createBoard({
    ownerId: user.id,
    teamId: team.id,
    googleAccountId: googleAccount.id,
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
  await writeFile(fixtureFile, JSON.stringify({
    taskId: board.task.id,
    title: board.task.title,
    description: "This seeded ticket must open from its board card.",
    detailPath: `/detail/project-${board.id}/${board.task.uniqueIndex}`,
    flags,
    ...(localPremerge ? { searchRows: [board, demoBoard].map(project => ({
      id: String(project.task.id),
      ticketNumber: project.task.ticketNumber,
      title: project.task.title,
      descriptionText: "This seeded ticket must open from its board card.",
      projectId: project.id,
      creatorName: user.displayName,
      status: project.task.status,
      updatedAt: project.task.updatedAt.toISOString(),
      searchText: project.task.title,
      uniqueIndex: project.task.uniqueIndex,
      projectTitle: project.title,
    })) } : {}),
  }));
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `board_path=/project?id=${board.id}&surface=board\ndemo_board_path=/project?id=${demoBoard.id}&surface=board\n`,
  );
}

try {
  if (localPremerge) {
    const { FEATURE_FLAG_KEYS } = jiti(path.join(root, "src/lib/flags.ts"));
    const overrides = process.argv.slice(2);
    if (overrides.some((value, index) => index % 2 === 0 && value !== "--flag") || overrides.length % 2) {
      throw new Error("Invalid local flag arguments");
    }
    modes = localFlagModes(FEATURE_FLAG_KEYS, await readPlainQaFlags(), overrides.filter((_, index) => index % 2));
    await writeFile(path.join(path.dirname(stateFile), "flag-modes.json"), JSON.stringify({ modes }));
  }
  for (const [key, mode] of Object.entries(modes)) {
    await prisma.featureFlag.upsert({ where: { key }, create: { key, mode }, update: { mode } });
  }
  const flags = Object.fromEntries(Object.entries(modes).map(([key, mode]) => [key, mode === "EVERYONE" || (localPremerge && mode === "OWNER_AND_QA")]));
  if (instantOpenControl) {
    // Exercise the released path even while production has contained it with OFF.
    const fixture = JSON.parse(await readFile(fixtureFile, "utf8"));
    await writeFile(fixtureFile, JSON.stringify({ ...fixture, flags }));
  } else {
    await seedSessionFixtures(flags);
  }
  console.log("Seeded isolated browser smoke fixtures.");
} finally {
  await prisma.$disconnect();
}
