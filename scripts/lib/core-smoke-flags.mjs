const FLAG_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseFlagKeys(raw) {
  const keys = [...new Set(String(raw ?? "").split(",").map((key) => key.trim()).filter(Boolean))];
  for (const key of keys) {
    if (!FLAG_KEY.test(key)) throw new Error(`Invalid core smoke flag key: ${key}`);
  }
  return keys;
}

export async function seedFlagKeys({ keys, prisma, withFlagModeInvalidation }) {
  const list = Array.isArray(keys) ? keys : [];
  if (list.length === 0) return 0;
  await withFlagModeInvalidation(async () => {
    for (const key of list) {
      await prisma.featureFlag.upsert({
        where: { key },
        create: { key, mode: "EVERYONE" },
        update: { mode: "EVERYONE" },
      });
    }
  });
  return list.length;
}
