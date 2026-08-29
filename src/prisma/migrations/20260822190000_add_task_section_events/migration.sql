-- HTPR-4631: record every task section transition for per-column velocity.
CREATE TABLE "TaskSectionEvent" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "from" VARCHAR(255) NOT NULL,
    "to" VARCHAR(255) NOT NULL,
    "userId" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskSectionEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskSectionEvent_taskId_timestamp_idx"
ON "TaskSectionEvent"("taskId", "timestamp");

ALTER TABLE "TaskSectionEvent"
ADD CONSTRAINT "TaskSectionEvent_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskSectionEvent"
ADD CONSTRAINT "TaskSectionEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
