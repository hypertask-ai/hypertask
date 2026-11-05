CREATE TABLE "AiLabelClassification" (
    "taskId" INTEGER NOT NULL,
    "labelId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "matches" BOOLEAN NOT NULL,
    CONSTRAINT "AiLabelClassification_pkey" PRIMARY KEY ("taskId", "labelId")
);

CREATE INDEX "AiLabelClassification_labelId_idx" ON "AiLabelClassification"("labelId");

ALTER TABLE "AiLabelClassification" ADD CONSTRAINT "AiLabelClassification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiLabelClassification" ADD CONSTRAINT "AiLabelClassification_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;
