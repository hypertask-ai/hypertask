export const resolveAuthorizedLocalFallback = async ({
  boardPayload,
  localBoardPublication,
}: {
  boardPayload: unknown | null;
  localBoardPublication: Promise<boolean>;
}): Promise<boolean> =>
  boardPayload === null ? await localBoardPublication : false;
