import { ensureHtpr7038ModelReset } from "@/lib/ai/htpr7038ModelReset";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

const CACHE_KEY_PREFIX = "user:";
const CACHE_TTL_SECONDS = 300;

const INVALIDATED = "__invalidated__";
const INVALIDATION_WINDOW_SECONDS = 10;

const preferencesCacheKey = (userId: number) =>
  `${CACHE_KEY_PREFIX}${userId}:user-preferences`;

export async function fetchUserPreferenceController(userId: number) {
  try {
    const reset = await ensureHtpr7038ModelReset(userId);
    const redis = await getRedis();
    const cacheKey = preferencesCacheKey(userId);
    const cached = await redis.get(cacheKey);
    if (reset !== "reset" && cached && cached !== INVALIDATED) {
      return { status: 200, res: { aiChatOpenNewTickets: null, aiChatOpenTickets: null, aiChatOpenBoards: null, ...JSON.parse(cached) } };
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
        autoDescriptionSuggestions: true,
        dictationLanguage: true,
        inboxAdvanceOnSend: true,
        emojiFrequency: true,
        calendarViews: true,
        allTasksDateRange: true,
        boardSortMode: true,
        aiChatOpenNewTickets: true,
        aiChatOpenTickets: true,
        aiChatOpenBoards: true,
      },
    });

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
          autoDescriptionSuggestions: true,
          dictationLanguage: "en",
          inboxAdvanceOnSend: true,
          emojiFrequency: null,
          calendarViews: null,
          allTasksDateRange: null,
          boardSortMode: null,
          aiChatOpenNewTickets: null,
          aiChatOpenTickets: null,
          aiChatOpenBoards: null,
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
        autoDescriptionSuggestions: true,
        dictationLanguage: "en",
        inboxAdvanceOnSend: true,
        emojiFrequency: null,
        calendarViews: null,
        allTasksDateRange: null,
        boardSortMode: null,
        aiChatOpenNewTickets: null,
        aiChatOpenTickets: null,
        aiChatOpenBoards: null,
      },
    };
  }
}

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
