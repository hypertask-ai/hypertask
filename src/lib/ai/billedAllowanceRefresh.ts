import { randomUUID } from "node:crypto";
import {
  BILLED_ALLOWANCE_SCOPE_INDEX,
  billedAllowancePeriod,
  effectiveAccountingSource,
  resolveBilledFunding,
} from "@/app/api/ai/_lib/sharedAllowance";
import { featureFlagCandidateUserIds } from "@/lib/flags";
import { HTPR_7692_BILLED_COST_FLAG } from "@/lib/flags/definitions/htpr-7692-billed-cost";
import { getRedis } from "@/lib/redis";

export async function refreshActiveBilledAllowances() {
  const redis = await getRedis();
  if (!await redis.exists(BILLED_ALLOWANCE_SCOPE_INDEX)) return;
  if ((await featureFlagCandidateUserIds(HTPR_7692_BILLED_COST_FLAG))?.length === 0) return;
  const deadline = Date.now() + 30_000;
  let offset = Number(await redis.get(`${BILLED_ALLOWANCE_SCOPE_INDEX}:cursor`) ?? 0);
  let members = await redis.zrange(BILLED_ALLOWANCE_SCOPE_INDEX, String(offset), String(offset + 99));
  if (!members.length && offset > 0) {
    offset = 0;
    members = await redis.zrange(BILLED_ALLOWANCE_SCOPE_INDEX, "0", "99");
  }
  const token = randomUUID();
  const lease = `${BILLED_ALLOWANCE_SCOPE_INDEX}:lease`;
  if (!await redis.set(lease, token, "EX", 35, "NX")) return;
  try {
    let processed = 0;
    let removed = 0;
    for (let position = 0; position < members.length && Date.now() < deadline - 6_000; position += 4) {
      if (await redis.get(lease) !== token) return;
      const batch = members.slice(position, position + 4);
      await Promise.all(batch.map(async (member) => {
        processed++;
        try {
          const match = /^([A-Za-z0-9_-]{1,80})\|(\d{4}-\d{2})\|(\d{4}-\d{2}-\d{2})$/.exec(member);
          if (!match) {
            removed += await redis.zrem(BILLED_ALLOWANCE_SCOPE_INDEX, member);
            return;
          }
          const [, teamId, month, day] = match;
          if (Date.now() >= Math.max(billedAllowancePeriod("month", month).expiresAt, billedAllowancePeriod("day", day).expiresAt)) {
            removed += await redis.zrem(BILLED_ALLOWANCE_SCOPE_INDEX, member);
            return;
          }
          const funding = await resolveBilledFunding(teamId === "demo" ? { fundingSource: "demo" } : { teamId });
          for (const [kind, period] of [["month", month], ["day", day]] as const) {
            if (kind === "day" && teamId === "demo") continue;
            if (Date.now() >= billedAllowancePeriod(kind, period).expiresAt) continue;
            if (Date.now() >= deadline - 3_000) return;
            await effectiveAccountingSource({ teamId, kind, period, funding });
          }
        } catch {}
      }));
    }
    await redis.eval(`
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[2], ARGV[2])
return 1
`, 2, lease, `${BILLED_ALLOWANCE_SCOPE_INDEX}:cursor`, token,
      String(processed === members.length && members.length < 100 ? 0 : offset + processed - removed));
  } finally {
    await redis.eval(`
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end
return 0
`, 1, lease, token);
  }
}
