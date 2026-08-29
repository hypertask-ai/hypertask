import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

const CACHE_KEY_PREFIX = "user:";
const CACHE_TTL_SECONDS = 300; // 5 minutes

// A write does not just delete the key, it leaves this marker for a few seconds.
// Without it a read that missed the cache, then lost the race to a write, would
// SETEX its now-outdated database result and serve stale preferences for the
// full 5 minutes (HTPR-4690). A read that finds the marker treats it as a miss
// and declines to cache what it read.
const INVALIDATED = "__invalidated__";
const INVALIDATION_WINDOW_SECONDS = 10;

const preferencesCacheKey = (userId: number) =>
  `${CACHE_KEY_PREFIX}${userId}:user-preferences`;

export async function fetchUserPreferenceController(userId: number) {
  try {
    const redis = await getRedis();
    const cacheKey = preferencesCacheKey(userId);
    const cached = await redis.get(cacheKey);
    if (cached && cached !== INVALIDATED) {
      return { status: 200, res: { ...JSON.parse(cached) } };
    }

    const res = await prisma.userSetting.findUnique({
      where: {
        userId,
      },
      select: {
        displayAvatar: true,
        commentsStacked: true,
        shareReadReceipts: true,
        scrollSetting: true,
        notification: true,
        notificationPreference: true,
        aiModelPreferences: true,
        snippets: true,
        muteAnnouncements: true,
        playGifs: true,
        dictationLanguage: true,
        inboxAdvanceOnSend: true,
        emojiFrequency: true,
        calendarViews: true,
        allTasksDateRange: true,
      },
    });

    // ponytail: re-read rather than a version/CAS scheme. It closes the whole
    // database-read window down to the microseconds between this GET and the
    // SETEX below, which is as far as a plain read-through cache needs to go.
    const marker = await redis.get(cacheKey);
    if (marker !== INVALIDATED) {
      await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(res));
    }

    if (!res) {
      return {
        status: 404,
        res: {
          commentsStacked: false,
          shareReadReceipts: false,
          scrollSetting: "Bottom",
          displayAvatar: "Hidden",
          notification: false,
          notificationPreference: "direct",
          aiModelPreferences: null,
          snippets: [],
          muteAnnouncements: false,
          playGifs: true,
          dictationLanguage: "en",
          inboxAdvanceOnSend: true,
          emojiFrequency: null,
          calendarViews: null,
          allTasksDateRange: null,
        },
      };
    }

    return { status: 200, res };
  } catch (error) {
    console.log("🚀 ~ fetchUserPreferenceController ~ error:", error);
    return {
      status: 500,
      res: {
        commentsStacked: false,
        shareReadReceipts: false,
        scrollSetting: "Bottom",
        displayAvatar: "Hidden",
        notification: false,
        notificationPreference: "direct",
        aiModelPreferences: null,
        snippets: [],
        muteAnnouncements: false,
        playGifs: true,
        dictationLanguage: "en",
        inboxAdvanceOnSend: true,
        emojiFrequency: null,
        calendarViews: null,
        allTasksDateRange: null,
      },
    };
  }
}

//invalidate the cache when a user preference is updated
export async function invalidateUserPreferenceCache(userId: number) {
  try {
    const redis = await getRedis();
    await redis.setex(
      preferencesCacheKey(userId),
      INVALIDATION_WINDOW_SECONDS,
      INVALIDATED
    );
  } catch (err) {
    console.warn(
      "[invalidateUserPreferenceCache] Cache invalidation failed:",
      err,
    );
  }
}
