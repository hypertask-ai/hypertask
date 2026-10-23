ALTER TABLE "Project"
ADD COLUMN "firstTaskPointerTaskId" INTEGER,
ADD COLUMN "firstTaskPointerSectionId" INTEGER,
ADD COLUMN "firstRealTaskCreatedAt" TIMESTAMP(3);
