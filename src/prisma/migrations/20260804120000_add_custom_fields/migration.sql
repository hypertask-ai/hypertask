-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('Text', 'Number', 'Date', 'Select', 'Checkbox');

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL DEFAULT 'Text',
    "options" JSONB,
    "ranking" TEXT NOT NULL DEFAULT 'A0200',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldValue" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "taskId" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "numericValue" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomField_projectId_idx" ON "CustomField"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_projectId_name_key" ON "CustomField"("projectId", "name");

-- CreateIndex
CREATE INDEX "CustomFieldValue_taskId_idx" ON "CustomFieldValue"("taskId");

-- CreateIndex
CREATE INDEX "CustomFieldValue_fieldId_numericValue_idx" ON "CustomFieldValue"("fieldId", "numericValue");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldValue_fieldId_taskId_key" ON "CustomFieldValue"("fieldId", "taskId");

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
