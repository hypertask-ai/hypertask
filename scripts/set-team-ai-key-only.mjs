const teamIdFlag = process.argv.indexOf("--team");
const teamId = teamIdFlag >= 0 ? process.argv[teamIdFlag + 1] : "";
const enable = process.argv.includes("--on");
const disable = process.argv.includes("--off");
const apply = process.argv.includes("--apply");

if (!/^[0-9a-f-]{36}$/i.test(teamId || "") || enable === disable) {
  console.error("Usage: node scripts/set-team-ai-key-only.mjs --team <uuid> --on|--off [--apply]");
  process.exit(1);
}

const next = enable;
console.log(`${apply ? "apply" : "dry-run"} team ${teamId} aiKeyOnly=${next}`);
if (!apply) process.exit(0);

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
try {
  const updated = await prisma.team.update({
    where: { id: teamId },
    data: { aiKeyOnly: next },
    select: { id: true, aiKeyOnly: true },
  });
  console.log(`updated ${updated.id} aiKeyOnly=${updated.aiKeyOnly}`);
} finally {
  await prisma.$disconnect();
}
