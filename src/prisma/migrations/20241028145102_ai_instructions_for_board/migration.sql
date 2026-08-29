-- CreateTable
CREATE TABLE "AI_Custom_Instructions" (
    "id" SERIAL NOT NULL,
    "visibility" "ViewVisibility" NOT NULL DEFAULT 'Public',
    "projectId" INTEGER NOT NULL,
    "customInstruction" TEXT NOT NULL,
    "source_selected" TEXT DEFAULT 'Claude',
    "model_selected" TEXT DEFAULT 'gpt-4o',
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AI_Custom_Instructions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AI_Custom_Instructions" ADD CONSTRAINT "AI_Custom_Instructions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
