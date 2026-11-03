const teamIdFlag = process.argv.indexOf("--team");
const teamId = teamIdFlag >= 0 ? process.argv[teamIdFlag + 1] : "";
const enable = process.argv.includes("--on");
const disable = process.argv.includes("--off");
const allowPlatform = process.argv.includes("--allow-platform-search-dictation");
const denyPlatform = process.argv.includes("--deny-platform-search-dictation");
const apply = process.argv.includes("--apply");

if (!/^[0-9a-f-]{36}$/i.test(teamId || "") || enable === disable || (allowPlatform && (denyPlatform || disable))) {
  console.error("Usage: node scripts/set-team-ai-key-only.mjs --team <uuid> --on|--off [--allow-platform-search-dictation|--deny-platform-search-dictation] [--apply]");
  process.exit(1);
}

const next = enable;
const platformServices = enable && allowPlatform;
console.log(`${apply ? "apply" : "dry-run"} team ${teamId} aiKeyOnly=${next} aiKeyOnlyPlatformServices=${platformServices}`);
if (!apply) process.exit(0);

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
try {
  const updated = await prisma.team.update({
    where: { id: teamId },
    data: { aiKeyOnly: next, aiKeyOnlyPlatformServices: platformServices },
    select: { id: true, aiKeyOnly: true, aiKeyOnlyPlatformServices: true },
  });
  console.log(`updated ${updated.id} aiKeyOnly=${updated.aiKeyOnly} aiKeyOnlyPlatformServices=${updated.aiKeyOnlyPlatformServices}`);
} finally {
  await prisma.$disconnect();
}
