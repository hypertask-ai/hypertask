-- HTPR-5678: remember the All Tasks date-range selector on the account.
ALTER TABLE "UserSetting" ADD COLUMN "allTasksDateRange" TEXT;
