export const ANNOUNCEMENT_USER_BATCH_SIZE = 40;
export const WELCOME_USER_IDS = [1, 4, 6, 46, 193];

type AnnouncementBody = Record<string, unknown> & { newUserMark?: boolean };

export function announcementIsWelcome(body: unknown): boolean {
  return Boolean((body as AnnouncementBody | null | undefined)?.newUserMark);
}

export function userBatches(
  userIds: readonly number[],
  batchSize = ANNOUNCEMENT_USER_BATCH_SIZE,
): number[][] {
  const batches: number[][] = [];
  for (let index = 0; index < userIds.length; index += batchSize) {
    batches.push(userIds.slice(index, index + batchSize));
  }
  return batches;
}
