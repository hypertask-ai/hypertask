export type EmailSettingWriter = {
  userSetting: {
    updateMany: (args: {
      where: { userId: number };
      data: { notification: boolean };
    }) => Promise<unknown>;
  };
};

export async function silenceCoreSmokeEmail(
  userId: number,
  db: EmailSettingWriter,
): Promise<void> {
  await db.userSetting.updateMany({
    where: { userId },
    data: { notification: false },
  });
}
