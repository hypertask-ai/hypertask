-- CreateEnum
CREATE TYPE "TaskRelation" AS ENUM ('RelatedTo', 'BlockedBy', 'BlockedTo');

-- CreateTable
CREATE TABLE "TaskRelations" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceTaskId" INTEGER NOT NULL,
    "targetTaskId" INTEGER NOT NULL,
    "relationType" "TaskRelation" NOT NULL DEFAULT 'RelatedTo',

    CONSTRAINT "TaskRelations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskRelations_sourceTaskId_targetTaskId_key" ON "TaskRelations"("sourceTaskId", "targetTaskId");

-- AddForeignKey
ALTER TABLE "TaskRelations" ADD CONSTRAINT "TaskRelations_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRelations" ADD CONSTRAINT "TaskRelations_targetTaskId_fkey" FOREIGN KEY ("targetTaskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
